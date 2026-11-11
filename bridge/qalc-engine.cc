// qalc-engine: a small line-based JSON bridge between the Android UI and
// libqalculate (the official Qalculate! calculation engine).
//
// Protocol: one JSON object per line on stdin, one JSON object per line on stdout.
//   {"id":1,"cmd":"calc","expr":"5 km to mi","opts":{...},"timeout":5000,"store":true}
//   {"id":2,"cmd":"plot","exprs":["sin(x)"],"min":"-10","max":"10","steps":300,"var":"x"}
//   {"id":11,"cmd":"plot3d","exprs":["sin(x) cos(y)"],"xmin":"-5","xmax":"5","ymin":"-5","ymax":"5","nx":41,"ny":41}
//   {"id":3,"cmd":"catalog","kind":"functions"|"variables"|"units"}
//   {"id":4,"cmd":"rates_info"} / {"id":5,"cmd":"rates_reload"}
//   {"id":6,"cmd":"define_var","name":"r","value":"5 cm"}
//   {"id":7,"cmd":"define_func","name":"f","expr":"x^2 + y"}
//   {"id":8,"cmd":"delete_def","kind":"variable"|"function","name":"r"}
//   {"id":9,"cmd":"user_defs"}
//   {"id":10,"cmd":"set_ans","expr":"1/3"}       (the app restores "ans" in a new engine process)
//
// After a calculation with "store":true, an event line follows the reply:
//   {"event":"ans","id":<id of that calculation>,"value":"<ans, re-readable>","input":"<text to insert>"}
//
// License: GPL-2.0-or-later (same as libqalculate).

#include <libqalculate/qalculate.h>
#include <libxml/parser.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iostream>
#include <map>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <vector>
#include <atomic>
#include <mutex>
#include <thread>
#include <exception>

#ifndef QALC_ENGINE_VERSION
#define QALC_ENGINE_VERSION "unknown"
#endif

using std::string;
using std::vector;

// libqalculate helpers that are exported by the library but not declared in the installed headers
void fix_user_function_expression(std::string &str, const EvaluationOptions &eo);
bool convert_for_time_format(MathStructure &m, const EvaluationOptions &eo, bool top);
int has_information_unit(const MathStructure &m, bool top);

static long now_ms() {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long) ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

// ------------------------------------------------------------ output/watchdog
// Some libqalculate operations (huge GMP/MPFR computations) never check the abort flag,
// so a time limit alone cannot guarantee an answer. The watchdog answers the pending
// request itself and exits; the app starts a fresh engine for the next request.
static std::mutex out_mutex;
static std::atomic<long> wd_deadline(0);
static string wd_id = "null";
// Replies go to a private copy of stdout; anything libqalculate prints by itself (it has a few
// debug prints) goes to stderr instead, so that it can never mix with the replies (see main()).
static FILE *proto = stdout;

static void write_line(const string &s) {
	std::lock_guard<std::mutex> lock(out_mutex);
	fwrite(s.data(), 1, s.size(), proto);
	fputc('\n', proto);
	fflush(proto);
	wd_deadline = 0;
}

// An exception that escapes (also from libqalculate's calculation thread, e.g. std::bad_alloc
// for a gigantic matrix) answers the pending request instead of killing the engine silently,
// so that the app does not resend the same request to a fresh engine.
static void on_terminate() {
	if(out_mutex.try_lock()) {
		string s = "{\"id\":" + wd_id + ",\"ok\":false,\"error\":\"計算に必要なメモリが不足しました\",\"restart\":true}\n";
		fwrite(s.data(), 1, s.size(), proto);
		fflush(proto);
	}
	_exit(5);
}

static void watchdog() {
	while(true) {
		usleep(200000);
		long d = wd_deadline.load();
		if(d <= 0 || now_ms() < d) continue;
		std::lock_guard<std::mutex> lock(out_mutex);
		if(wd_deadline.load() != d) continue;
		string s = "{\"id\":" + wd_id + ",\"ok\":true,\"result\":\"\",\"parsed\":\"\",\"approx\":false,\"comparison\":false,\"timeout\":true,\"restart\":true,\"messages\":[]}\n";
		fwrite(s.data(), 1, s.size(), proto);
		fflush(proto);
		_exit(3);
	}
}

// ---------------------------------------------------------------- JSON input
struct JVal {
	enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } t = NUL;
	bool b = false;
	double n = 0;
	string s;
	vector<JVal> a;
	std::map<string, JVal> o;
	const JVal *get(const string &k) const {
		if(t != OBJ) return NULL;
		std::map<string, JVal>::const_iterator it = o.find(k);
		return it == o.end() ? NULL : &it->second;
	}
	string str(const string &k, const string &def = "") const {
		const JVal *v = get(k);
		return (v && v->t == STR) ? v->s : def;
	}
	double num(const string &k, double def) const {
		const JVal *v = get(k);
		return (v && v->t == NUM) ? v->n : def;
	}
	bool boolean(const string &k, bool def) const {
		const JVal *v = get(k);
		return (v && v->t == BOOL) ? v->b : def;
	}
	// double -> int without undefined behaviour for NaN/huge values
	int integer(const string &k, int def, int lo, int hi) const {
		double d = num(k, def);
		if(!(d == d)) return def;
		if(d < lo) return lo;
		if(d > hi) return hi;
		return (int) d;
	}
};

struct JParser {
	const char *p, *e;
	bool ok;
	JParser(const string &s) : p(s.c_str()), e(s.c_str() + s.size()), ok(true) {}
	void ws() { while(p < e && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++; }
	static void put_utf8(string &out, unsigned long cp) {
		if(cp < 0x80) out += (char) cp;
		else if(cp < 0x800) { out += (char) (0xC0 | (cp >> 6)); out += (char) (0x80 | (cp & 0x3F)); }
		else if(cp < 0x10000) { out += (char) (0xE0 | (cp >> 12)); out += (char) (0x80 | ((cp >> 6) & 0x3F)); out += (char) (0x80 | (cp & 0x3F)); }
		else { out += (char) (0xF0 | (cp >> 18)); out += (char) (0x80 | ((cp >> 12) & 0x3F)); out += (char) (0x80 | ((cp >> 6) & 0x3F)); out += (char) (0x80 | (cp & 0x3F)); }
	}
	bool hex4(unsigned long &v) {
		if(e - p < 4) return false;
		v = 0;
		for(int i = 0; i < 4; i++) {
			char c = *p++;
			v <<= 4;
			if(c >= '0' && c <= '9') v |= c - '0';
			else if(c >= 'a' && c <= 'f') v |= c - 'a' + 10;
			else if(c >= 'A' && c <= 'F') v |= c - 'A' + 10;
			else return false;
		}
		return true;
	}
	bool parse_string(string &out) {
		if(p >= e || *p != '"') return false;
		p++;
		while(p < e && *p != '"') {
			if(*p == '\\') {
				p++;
				if(p >= e) return false;
				char c = *p++;
				switch(c) {
					case '"': out += '"'; break;
					case '\\': out += '\\'; break;
					case '/': out += '/'; break;
					case 'b': out += '\b'; break;
					case 'f': out += '\f'; break;
					case 'n': out += '\n'; break;
					case 'r': out += '\r'; break;
					case 't': out += '\t'; break;
					case 'u': {
						unsigned long cp;
						if(!hex4(cp)) return false;
						if(cp >= 0xD800 && cp <= 0xDBFF) {
							unsigned long lo = 0;
							const char *save = p;
							if(e - p >= 6 && p[0] == '\\' && p[1] == 'u') { p += 2; if(!hex4(lo)) return false; }
							if(lo >= 0xDC00 && lo <= 0xDFFF) cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
							else { cp = 0xFFFD; p = save; }  // unpaired: keep what follows
						} else if(cp >= 0xDC00 && cp <= 0xDFFF) {
							cp = 0xFFFD;
						}
						put_utf8(out, cp);
						break;
					}
					default: return false;
				}
			} else {
				out += *p++;
			}
		}
		if(p >= e) return false;
		p++;
		return true;
	}
	bool parse(JVal &v, int depth = 0) {
		if(depth > 32) return false;
		ws();
		if(p >= e) return false;
		if(*p == '{') {
			p++;
			v.t = JVal::OBJ;
			ws();
			if(p < e && *p == '}') { p++; return true; }
			while(true) {
				ws();
				string k;
				if(!parse_string(k)) return false;
				ws();
				if(p >= e || *p != ':') return false;
				p++;
				JVal child;
				if(!parse(child, depth + 1)) return false;
				v.o[k] = child;
				ws();
				if(p < e && *p == ',') { p++; continue; }
				if(p < e && *p == '}') { p++; return true; }
				return false;
			}
		} else if(*p == '[') {
			p++;
			v.t = JVal::ARR;
			ws();
			if(p < e && *p == ']') { p++; return true; }
			while(true) {
				JVal child;
				if(!parse(child, depth + 1)) return false;
				v.a.push_back(child);
				ws();
				if(p < e && *p == ',') { p++; continue; }
				if(p < e && *p == ']') { p++; return true; }
				return false;
			}
		} else if(*p == '"') {
			v.t = JVal::STR;
			return parse_string(v.s);
		} else if(e - p >= 4 && strncmp(p, "true", 4) == 0) {
			p += 4; v.t = JVal::BOOL; v.b = true; return true;
		} else if(e - p >= 5 && strncmp(p, "false", 5) == 0) {
			p += 5; v.t = JVal::BOOL; v.b = false; return true;
		} else if(e - p >= 4 && strncmp(p, "null", 4) == 0) {
			p += 4; v.t = JVal::NUL; return true;
		} else {
			// only the JSON number grammar (strtod would also accept 0x10, nan, inf)
			const char *q = p;
			if(q < e && *q == '-') q++;
			if(q >= e || *q < '0' || *q > '9') return false;
			while(q < e && ((*q >= '0' && *q <= '9') || *q == '.' || *q == 'e' || *q == 'E' || *q == '+' || *q == '-')) q++;
			string num(p, q - p);
			char *end = NULL;
			v.n = strtod(num.c_str(), &end);
			if(!end || *end != '\0' || !std::isfinite(v.n)) return false;
			p = q;
			v.t = JVal::NUM;
			return true;
		}
	}
};

// --------------------------------------------------------------- JSON output
static string jstr(const string &s) {
	string o = "\"";
	for(size_t i = 0; i < s.size(); i++) {
		unsigned char c = (unsigned char) s[i];
		switch(c) {
			case '"': o += "\\\""; break;
			case '\\': o += "\\\\"; break;
			case '\n': o += "\\n"; break;
			case '\r': o += "\\r"; break;
			case '\t': o += "\\t"; break;
			default:
				if(c < 0x20) {
					char buf[8];
					snprintf(buf, sizeof(buf), "\\u%04x", c);
					o += buf;
				} else if(c == 0xE2 && i + 2 < s.size() && (unsigned char) s[i + 1] == 0x80 && ((unsigned char) s[i + 2] == 0xA8 || (unsigned char) s[i + 2] == 0xA9)) {
					// U+2028 / U+2029 are not valid inside older JavaScript string literals
					o += ((unsigned char) s[i + 2] == 0xA8) ? "\\u2028" : "\\u2029";
					i += 2;
				} else {
					o += (char) c;
				}
		}
	}
	o += "\"";
	return o;
}

static string jnum(double d) {
	if(!std::isfinite(d)) return "null";
	char buf[40];
	snprintf(buf, sizeof(buf), "%.17g", d);
	return buf;
}

struct JOut {
	string s;
	bool first;
	JOut() : s("{"), first(true) {}
	JOut &raw(const string &k, const string &v) {
		if(!first) s += ",";
		first = false;
		s += jstr(k);
		s += ":";
		s += v;
		return *this;
	}
	JOut &str(const string &k, const string &v) { return raw(k, jstr(v)); }
	JOut &num(const string &k, double v) { return raw(k, jnum(v)); }
	JOut &boolean(const string &k, bool v) { return raw(k, v ? "true" : "false"); }
	string done() { return s + "}"; }
};

// ------------------------------------------------------------------ helpers
static KnownVariable *vans[5];

static void mkdirs(const string &path) {
	string cur;
	for(size_t i = 0; i < path.size(); i++) {
		cur += path[i];
		if((path[i] == '/' && i > 0) || i + 1 == path.size()) mkdir(cur.c_str(), 0700);
	}
}

static string collect_messages() {
	string out = "[";
	bool first = true;
	for(CalculatorMessage *m = CALCULATOR->message(); m; m = CALCULATOR->nextMessage()) {
		if(!first) out += ",";
		first = false;
		const char *type = m->type() == MESSAGE_ERROR ? "error" : (m->type() == MESSAGE_WARNING ? "warning" : "info");
		out += "{\"type\":\"";
		out += type;
		out += "\",\"text\":";
		out += jstr(m->message());
		out += "}";
	}
	out += "]";
	CALCULATOR->clearMessages();
	return out;
}

// Cut a UTF-8 string to at most max_bytes without splitting a character.
static bool truncate_utf8(string &s, size_t max_bytes) {
	if(s.size() <= max_bytes) return false;
	size_t n = max_bytes;
	while(n > 0 && ((unsigned char) s[n] & 0xC0) == 0x80) n--;
	s.resize(n);
	s += "…";
	return true;
}

// A value as text that can be typed back into an expression: decimal, or a fraction when a
// decimal would not be exact, no digit grouping, and all digits of exact numbers.
static string print_input(const MathStructure &value) {
	PrintOptions po;
	po.base = 10;
	po.number_fraction_format = FRACTION_DECIMAL_EXACT; // 1.524 and 1/3, never rounded
	po.restrict_fraction_length = false;
	po.digit_grouping = DIGIT_GROUPING_NONE;
	po.interval_display = INTERVAL_DISPLAY_SIGNIFICANT_DIGITS;
	po.min_exp = value.isApproximate() ? EXP_PRECISION : EXP_NONE;
	po.exp_display = EXP_UPPERCASE_E;
	po.use_unicode_signs = true;
	po.multiplication_sign = MULTIPLICATION_SIGN_X;
	po.division_sign = DIVISION_SIGN_SLASH;
	po.spacious = true;
	po.short_multiplication = true;
	po.abbreviate_names = true;
	po.use_unit_prefixes = true;
	po.spell_out_logical_operators = true;
	MathStructure m(value);
	m.format(po);
	return m.print(po);
}

struct Opts {
	EvaluationOptions eo;
	PrintOptions po;
	AutomaticFractionFormat af;
	AutomaticApproximation aa;
};

static Opts make_opts(const JVal *o) {
	Opts r;
	// Start from the library's static defaults: some option fields (for example
	// ParseOptions::comma_as_separator) are not set by the constructors, so
	// objects built on the stack would contain garbage.
	r.eo = default_user_evaluation_options;
	r.po = default_print_options;
	EvaluationOptions &eo = r.eo;
	PrintOptions &po = r.po;
	eo.parse_options.comma_as_separator = false;
	eo.parse_options.dot_as_separator = false;
	eo.parse_options.limit_implicit_multiplication = false;
	eo.parse_options.parsing_mode = PARSING_MODE_ADAPTIVE;
	eo.parse_options.angle_unit = ANGLE_UNIT_RADIANS;
	eo.auto_post_conversion = POST_CONVERSION_OPTIMAL;
	eo.structuring = STRUCTURING_SIMPLIFY;
	eo.approximation = APPROXIMATION_TRY_EXACT;
	po.use_unicode_signs = true;
	po.multiplication_sign = MULTIPLICATION_SIGN_X;
	po.division_sign = DIVISION_SIGN_SLASH;
	po.spacious = true;
	po.short_multiplication = true;
	po.use_unit_prefixes = true;
	po.abbreviate_names = true;
	po.number_fraction_format = FRACTION_DECIMAL;
	po.interval_display = INTERVAL_DISPLAY_SIGNIFICANT_DIGITS;
	po.digit_grouping = DIGIT_GROUPING_NONE;
	po.base = 10;
	// same defaults as qalc's load_preferences()
	eo.parse_options.unknowns_enabled = false;        // typos are errors, not silent symbols
	eo.warn_about_denominators_assumed_nonzero = true;
	po.spell_out_logical_operators = true;            // "true"/"false", "and"/"or"
	po.base_display = BASE_DISPLAY_NORMAL;            // 0xFF, 0b..., 0o...: results can be pasted back
	po.exp_display = EXP_UPPERCASE_E;
	r.af = AUTOMATIC_FRACTION_AUTO;
	r.aa = AUTOMATIC_APPROXIMATION_AUTO;
	int prec = 10;
	if(o) {
		string ap = o->str("approx", "auto");
		if(ap == "exact") { eo.approximation = APPROXIMATION_EXACT; r.aa = AUTOMATIC_APPROXIMATION_OFF; }
		else if(ap == "approx") { eo.approximation = APPROXIMATION_APPROXIMATE; r.aa = AUTOMATIC_APPROXIMATION_OFF; }
		else if(ap == "dual") r.aa = AUTOMATIC_APPROXIMATION_DUAL;
		string fr = o->str("fraction", "auto");
		if(fr == "decimal") { po.number_fraction_format = FRACTION_DECIMAL; r.af = AUTOMATIC_FRACTION_OFF; }
		else if(fr == "exact") { po.number_fraction_format = FRACTION_DECIMAL_EXACT; r.af = AUTOMATIC_FRACTION_OFF; }
		else if(fr == "fraction") { po.number_fraction_format = FRACTION_FRACTIONAL; po.restrict_fraction_length = true; r.af = AUTOMATIC_FRACTION_OFF; }
		else if(fr == "combined") { po.number_fraction_format = FRACTION_COMBINED; po.restrict_fraction_length = true; r.af = AUTOMATIC_FRACTION_OFF; }
		else if(fr == "dual") r.af = AUTOMATIC_FRACTION_DUAL;
		string ang = o->str("angle", "rad");
		if(ang == "deg") eo.parse_options.angle_unit = ANGLE_UNIT_DEGREES;
		else if(ang == "gra") eo.parse_options.angle_unit = ANGLE_UNIT_GRADIANS;
		else if(ang == "none") eo.parse_options.angle_unit = ANGLE_UNIT_NONE;
		int base = o->integer("base", 10, -100, 100);
		if(base == -1 || (base >= 2 && base <= 36)) po.base = base;
		int ibase = o->integer("input_base", 10, -100, 100);
		if(ibase >= 2 && ibase <= 36) eo.parse_options.base = ibase;
		prec = o->integer("precision", 10, 2, 1000);
		int maxdec = o->integer("max_decimals", -1, -1, 1000);
		if(maxdec >= 0) { po.use_max_decimals = true; po.max_decimals = maxdec; }
		string units = o->str("units", "optimal");
		if(units == "none") eo.auto_post_conversion = POST_CONVERSION_NONE;
		else if(units == "si") eo.auto_post_conversion = POST_CONVERSION_OPTIMAL_SI;
		else if(units == "base") eo.auto_post_conversion = POST_CONVERSION_BASE;
		if(o->boolean("grouping", false)) po.digit_grouping = DIGIT_GROUPING_STANDARD;
		string cplx = o->str("complex", "rect");
		if(cplx == "exp") eo.complex_number_form = COMPLEX_NUMBER_FORM_EXPONENTIAL;
		else if(cplx == "polar") eo.complex_number_form = COMPLEX_NUMBER_FORM_POLAR;
		else if(cplx == "cis") eo.complex_number_form = COMPLEX_NUMBER_FORM_CIS;
		string notation = o->str("notation", "auto");
		if(notation == "sci") po.min_exp = EXP_SCIENTIFIC;
		else if(notation == "eng") po.min_exp = EXP_BASE_3;
		else if(notation == "pure") po.min_exp = EXP_PURE;
		else if(notation == "none") po.min_exp = EXP_NONE;
		string st = o->str("structuring", "simplify");
		if(st == "factorize") eo.structuring = STRUCTURING_FACTORIZE;
		else if(st == "expand") eo.structuring = STRUCTURING_EXPAND;
		if(!o->boolean("mixed_units", true)) eo.mixed_units_conversion = MIXED_UNITS_CONVERSION_NONE;
	}
	if(prec < 2) prec = 2;
	if(prec > 1000) prec = 1000;
	if(CALCULATOR->getPrecision() != prec) CALCULATOR->setPrecision(prec);
	return r;
}

// ---------------------------------------------------------------- commands
static bool test_parsed_comparison(const MathStructure &m) {
	if(m.isComparison()) return true;
	if((m.isLogicalOr() || m.isLogicalAnd()) && m.size() > 0) {
		for(size_t i = 0; i < m.size(); i++) if(!test_parsed_comparison(m[i])) return false;
		return true;
	}
	return false;
}

// qalc: "x = 2" / "x = 2 || x = -2" are stored in ans as their solutions
static bool is_equation_solutions(const MathStructure &m) {
	if(m.isComparison()) return m.comparisonType() == COMPARISON_EQUALS && m[0].isUnknown();
	if(m.isLogicalAnd()) {
		bool b = false;
		for(size_t i = 0; i < m.size(); i++) {
			if(!m[i].isComparison()) return false;
			if(m[i].comparisonType() == COMPARISON_EQUALS) {if(b || !m[i][0].isUnknown()) return false; b = true;}
		}
		return b;
	}
	if(m.isLogicalOr()) {
		for(size_t i = 0; i < m.size(); i++) {
			if(m[i].isComparison()) {
				if(m[i].comparisonType() != COMPARISON_EQUALS || !m[i][0].isUnknown()) return false;
			} else if(m[i].isLogicalAnd()) {
				bool b = false;
				for(size_t i2 = 0; i2 < m[i].size(); i2++) {
					if(!m[i][i2].isComparison()) return false;
					if(m[i][i2].comparisonType() == COMPARISON_EQUALS) {if(b || !m[i][i2][0].isUnknown()) return false; b = true;}
				}
				if(!b) return false;
			} else {
				return false;
			}
		}
		return true;
	}
	return false;
}

// Set when "ans" gets a new value; the main loop then reports it to the app as an event line.
static bool g_ans_changed = false;

// same as qalc's "update ans variables"
static void store_ans(MathStructure m) {
	g_ans_changed = true;
	MathStructure m4(vans[3]->get()); m4.replace(vans[4], vans[4]->get()); vans[4]->set(m4);
	MathStructure m3(vans[2]->get()); m3.replace(vans[3], vans[4]); vans[3]->set(m3);
	MathStructure m2(vans[1]->get()); m2.replace(vans[2], vans[3]); vans[2]->set(m2);
	MathStructure m1(vans[0]->get()); m1.replace(vans[1], vans[2]); vans[1]->set(m1);
	m.replace(vans[0], vans[1]);
	if(is_equation_solutions(m)) {
		if(m.isLogicalAnd()) {
			for(size_t i = 0; i < m.size(); i++) {
				if(m[i].comparisonType() == COMPARISON_EQUALS) {vans[0]->set(m[i][1]); break;}
			}
		} else if(m.isLogicalOr()) {
			m.setType(STRUCT_VECTOR);
			for(size_t i = 0; i < m.size(); i++) {
				if(m[i].isLogicalAnd()) {
					for(size_t i2 = 0; i2 < m[i].size(); i2++) {
						if(m[i][i2].comparisonType() == COMPARISON_EQUALS) {m[i].setToChild(i2 + 1); break;}
					}
				}
				m[i].setToChild(2);
			}
			vans[0]->set(m);
		} else {
			vans[0]->set(m[1]);
		}
	} else {
		vans[0]->set(m);
	}
}

// qalc's "adaptive" interval display
static void adaptive_interval_display(PrintOptions &po, const string &expr, const MathStructure &parsed) {
	if(parsed.containsFunctionId(FUNCTION_ID_UNCERTAINTY) || expr.find("+/-") != string::npos || expr.find("+/" SIGN_MINUS) != string::npos || expr.find(SIGN_PLUSMINUS) != string::npos) po.interval_display = INTERVAL_DISPLAY_PLUSMINUS;
	else if(parsed.containsFunctionId(FUNCTION_ID_INTERVAL)) po.interval_display = INTERVAL_DISPLAY_INTERVAL;
	else po.interval_display = INTERVAL_DISPLAY_SIGNIFICANT_DIGITS;
}

struct CalcResult {
	string result, parsed;
	bool approx = false, comparison = false, timed_out = false, forced = false, have_value = false;
	MathStructure value;
};

// The same steps as Calculator::calculateAndPrint(), but the expression is evaluated only once,
// in libqalculate's calculation thread (so that the time limit and abort() work), and the
// evaluated value is returned so that "ans" is exactly the value that was shown.
static void calculate_once(string str, int msecs, EvaluationOptions evalops, PrintOptions printops, AutomaticFractionFormat auto_fraction, AutomaticApproximation auto_approx, CalcResult &r) {
	long t0 = now_ms();
	bool is_approx = false;
	printops.is_approximate = &is_approx;
	if(auto_fraction != AUTOMATIC_FRACTION_OFF) printops.number_fraction_format = FRACTION_DECIMAL;
	if(auto_approx != AUTOMATIC_APPROXIMATION_OFF) evalops.approximation = APPROXIMATION_TRY_EXACT;

	string to_str = CALCULATOR->parseComments(str, evalops.parse_options);
	if(!to_str.empty() && str.empty()) return;

	// "to ..." directives: number bases, fractions, factors, time zones, units, ...
	string from_str = str;
	bool had_to = false, do_bases = false, do_calendars = false, do_factors = false, do_pfe = false, do_expand = false, caf = false, fraction_changed = false;
	int binary_prefixes = -1;
	Number custom_base;
	long int save_fden = CALCULATOR->fixedDenominator();
	int save_bin = CALCULATOR->usesBinaryPrefixes();
	Number save_cbase = CALCULATOR->customOutputBase();
	bool cbase_set = false;
	if(CALCULATOR->separateToExpression(from_str, to_str, evalops, true)) {
		had_to = true;
		NumberFractionFormat nff = printops.number_fraction_format;
		bool rfl = printops.restrict_fraction_length;
		string conv = CALCULATOR->parseToExpression(to_str, evalops, printops, &custom_base, &binary_prefixes, &caf, &do_factors, &do_pfe, &do_calendars, &do_bases);
		if(printops.number_fraction_format != nff || printops.restrict_fraction_length != rfl || to_str.find("decimals") != string::npos) {
			auto_fraction = AUTOMATIC_FRACTION_OFF;
			fraction_changed = true;
		}
		if(!custom_base.isZero()) {printops.base = BASE_CUSTOM; CALCULATOR->setCustomOutputBase(custom_base); cbase_set = true;}
		if(binary_prefixes == 0) CALCULATOR->useBinaryPrefixes(0);
		str = from_str;
		if(!conv.empty()) {str += " to "; str += conv;}
	}

	// "factor ..." / "expand ..." in front of the expression
	size_t i = str.find_first_of(SPACES);
	if(i != string::npos) {
		string w = str.substr(0, i);
		if(w == "factor" || equalsIgnoreCase(w, "factorize")) {str = str.substr(i + 1); do_factors = true; evalops.structuring = STRUCTURING_FACTORIZE;}
		else if(equalsIgnoreCase(w, "expand")) {str = str.substr(i + 1); evalops.structuring = STRUCTURING_SIMPLIFY; do_expand = true;}
	}
	transform_expression_for_equals_save(str, evalops.parse_options);

	MathStructure mstruct, parsed_struct;
	bool finished = CALCULATOR->calculate(&mstruct, str, msecs, evalops, &parsed_struct);
	if(!finished) {
		r.timed_out = true;
		r.forced = mstruct.isAborted();  // the calculation thread had to be cancelled
	}
	long left = msecs - (now_ms() - t0);
	if(!r.forced) {
		CALCULATOR->startControl(left > 200 ? left : 200);
		if(finished) {
			if(!had_to && ((evalops.approximation == APPROXIMATION_EXACT && evalops.auto_post_conversion != POST_CONVERSION_NONE) || evalops.auto_post_conversion == POST_CONVERSION_OPTIMAL)) convert_unchanged_quantity_with_unit(parsed_struct, mstruct, evalops);
			MathStructure mexact;
			mexact.setUndefined();
			if((!do_calendars || !mstruct.isDateTime()) && !do_bases && auto_approx != AUTOMATIC_APPROXIMATION_OFF && (auto_approx == AUTOMATIC_APPROXIMATION_DUAL || printops.base == BASE_DECIMAL) && now_ms() - t0 < msecs / 3) {
				calculate_dual_exact(mexact, &mstruct, str, &parsed_struct, evalops, auto_approx, 0, -1);
				if(CALCULATOR->aborted()) mexact.setUndefined();
			}
			if(do_factors) {
				if((mstruct.isNumber() || mstruct.isVector()) && !fraction_changed) {
					auto_fraction = AUTOMATIC_FRACTION_OFF;
					printops.restrict_fraction_length = false;
					printops.number_fraction_format = FRACTION_FRACTIONAL;
				}
				mstruct.integerFactorize();
				mexact.integerFactorize();
			} else if(do_expand) {
				mstruct.expand(evalops, false);
				mexact.expand(evalops, false);
			}
			if(do_pfe) {
				mstruct.expandPartialFractions(evalops);
				mexact.expandPartialFractions(evalops);
			}
			r.value = mstruct;
			r.have_value = true;
			adaptive_interval_display(printops, str, parsed_struct);
			printops.allow_factorization = printops.allow_factorization || evalops.structuring == STRUCTURING_FACTORIZE || do_factors;
			vector<string> alt_results;
			bool exact_comparison = false;
			string &result = r.result;
			if(do_calendars && mstruct.isDateTime()) {
				static const struct {const char *title; CalendarSystem c;} cal[] = {{"Gregorian:", CALENDAR_GREGORIAN}, {"Hebrew:", CALENDAR_HEBREW}, {"Islamic:", CALENDAR_ISLAMIC}, {"Persian:", CALENDAR_PERSIAN}, {"Indian national:", CALENDAR_INDIAN}, {"Chinese:", CALENDAR_CHINESE}, {"Julian:", CALENDAR_JULIAN}, {"Revised julian:", CALENDAR_MILANKOVIC}, {"Coptic:", CALENDAR_COPTIC}, {"Ethiopian:", CALENDAR_ETHIOPIAN}};
				for(size_t ic = 0; ic < sizeof(cal) / sizeof(cal[0]); ic++) {
					long int y, m, d;
					if(!result.empty()) result += "\n";
					result += cal[ic].title; result += " ";
					if(!dateToCalendar(*mstruct.datetime(), y, m, d, cal[ic].c)) {result += "failed"; continue;}
					result += i2s(d) + " " + monthName(m, cal[ic].c, true) + " " + i2s(y);
					if(cal[ic].c == CALENDAR_CHINESE) {
						long int cy, yc, st, br;
						chineseYearInfo(y, cy, yc, st, br);
						result += " (" + chineseStemName(st) + " " + chineseBranchName(br) + ")";
					}
				}
			} else if(do_bases) {
				int bases[] = {BASE_BINARY, BASE_OCTAL, BASE_DECIMAL, BASE_HEXADECIMAL};
				for(int ib = 0; ib < 4; ib++) {
					if(ib) result += " = ";
					printops.base = bases[ib];
					MathStructure m(mstruct);
					m.format(printops);
					result += m.print(printops);
				}
				if(caf) gsub(" cis ", "∠", result);
			} else {
				if(binary_prefixes == 2) {
					printops.use_unit_prefixes = true;
					int iu = has_information_unit(mstruct, true);
					CALCULATOR->useBinaryPrefixes(iu > 0 ? 1 : 2);
					if(iu == 1) printops.use_denominator_prefix = false;
					else if(iu > 1) printops.use_denominator_prefix = true;
					else {printops.use_prefixes_for_currencies = true; printops.use_prefixes_for_all_units = true;}
				}
				if(auto_fraction != AUTOMATIC_FRACTION_OFF || auto_approx != AUTOMATIC_APPROXIMATION_OFF) {
					print_dual(mstruct, str, parsed_struct, mexact, result, alt_results, printops, evalops, auto_fraction, auto_approx, caf, &exact_comparison, true, false, 0, TAG_TYPE_HTML, -1, had_to);
					if(!alt_results.empty()) {
						bool use_par = mstruct.isComparison() || mstruct.isLogicalAnd() || mstruct.isLogicalOr();
						string last = result;
						result = "";
						size_t n = 0;
						for(size_t ia = 0; ia < alt_results.size(); ia++) {
							if(alt_results[ia] == CALCULATOR->timedOutString()) continue;
							if(n++ > 0) result += " = ";
							if(use_par) result += "(";
							result += alt_results[ia];
							if(use_par) result += ")";
						}
						if(n == 0) {
							result = last;
						} else {
							result += (mstruct.isApproximate() || is_approx) ? " " SIGN_ALMOST_EQUAL " " : " = ";
							if(use_par) result += "(";
							result += last;
							if(use_par) result += ")";
						}
					} else if(mstruct.isComparison() || mstruct.isLogicalOr() || mstruct.isLogicalAnd()) {
						r.comparison = true;
					}
				} else {
					if(printops.spell_out_logical_operators && test_parsed_comparison(parsed_struct)) {
						if(mstruct.isZero()) {Variable *v = CALCULATOR->getActiveVariable("false"); if(v) mstruct.set(v);}
						else if(mstruct.isOne()) {Variable *v = CALCULATOR->getActiveVariable("true"); if(v) mstruct.set(v);}
					}
					if(printops.base == BASE_TIME) convert_for_time_format(mstruct, evalops, true);
					if(mstruct.isComparison() || mstruct.isLogicalOr() || mstruct.isLogicalAnd()) r.comparison = true;
					mstruct.removeDefaultAngleUnit(evalops);
					mstruct.format(printops);
					mstruct.removeDefaultAngleUnit(evalops);
					result = mstruct.print(printops);
					if(caf) gsub(" cis ", "∠", result);
				}
			}
			r.approx = (exact_comparison || !alt_results.empty()) ? false : (is_approx || r.value.isApproximate());
			if(CALCULATOR->aborted()) r.timed_out = true;
		}
		// parsed expression, printed as calculateAndPrint() does
		PrintOptions po_parsed;
		po_parsed.preserve_format = true;
		po_parsed.show_ending_zeroes = false;
		po_parsed.lower_case_e = printops.lower_case_e;
		po_parsed.lower_case_numbers = printops.lower_case_numbers;
		po_parsed.base_display = printops.base_display;
		po_parsed.twos_complement = printops.twos_complement;
		po_parsed.hexadecimal_twos_complement = printops.hexadecimal_twos_complement;
		po_parsed.base = evalops.parse_options.base;
		if(po_parsed.base == BASE_CUSTOM || (po_parsed.base < BASE_CUSTOM && !CALCULATOR->usesIntervalArithmetic() && po_parsed.base != BASE_UNICODE)) {
			po_parsed.base = 10;
			po_parsed.min_exp = 6;
			po_parsed.use_max_decimals = true;
			po_parsed.max_decimals = 5;
			po_parsed.preserve_format = false;
		}
		po_parsed.abbreviate_names = false;
		po_parsed.digit_grouping = printops.digit_grouping;
		po_parsed.use_unicode_signs = printops.use_unicode_signs;
		po_parsed.multiplication_sign = printops.multiplication_sign;
		po_parsed.division_sign = printops.division_sign;
		po_parsed.short_multiplication = false;
		po_parsed.excessive_parenthesis = true;
		po_parsed.improve_division_multipliers = false;
		po_parsed.restrict_to_parent_precision = false;
		po_parsed.spell_out_logical_operators = printops.spell_out_logical_operators;
		po_parsed.interval_display = INTERVAL_DISPLAY_PLUSMINUS;
		if(CALCULATOR->aborted()) {CALCULATOR->stopControl(); CALCULATOR->startControl(200);}
		parsed_struct.format(po_parsed);
		r.parsed = parsed_struct.print(po_parsed);
		CALCULATOR->stopControl();
	}
	if(cbase_set) CALCULATOR->setCustomOutputBase(save_cbase);
	CALCULATOR->useBinaryPrefixes(save_bin);
	CALCULATOR->setFixedDenominator(save_fden);
	if(r.timed_out) r.result = "";
}

// libqalculate parses and evaluates recursively; ~2000 nested calls overflow the stack (SIGSEGV)
static bool too_deeply_nested(const string &s, int max_depth = 300) {
	int depth = 0, powers = 0;
	for(size_t i = 0; i < s.size(); i++) {
		if(s[i] == '(' || s[i] == '[' || s[i] == '{') {if(++depth > max_depth) return true;}
		else if((s[i] == ')' || s[i] == ']' || s[i] == '}') && depth > 0) depth--;
		else if(s[i] == '^' && ++powers > 1000) return true;  // a^b^c^... nests to the right
	}
	return false;
}

static bool restart_after_reply = false;

// Functions that change something (definitions, files) instead of only computing a value.
static bool changes_something(const MathStructure &m, int depth = 0) {
	if(depth > 200) return false;
	if(m.isFunction() && m.function()) {
		switch(m.function()->id()) {
			case FUNCTION_ID_SAVE: case FUNCTION_ID_EXPORT: case FUNCTION_ID_COMMAND:
			case FUNCTION_ID_REGISTER: case FUNCTION_ID_STACK: case FUNCTION_ID_PLOT:
				return true;
		}
		if(m.function()->subtype() == SUBTYPE_USER_FUNCTION) {
			const string formula = ((UserFunction*) m.function())->formula();
			if(formula.find("save") != string::npos || formula.find("export") != string::npos || formula.find(":=") != string::npos) return true;
		}
	}
	for(size_t i = 0; i < m.size(); i++) if(changes_something(m[i], depth + 1)) return true;
	return false;
}

static string cmd_calc(const JVal &req, JOut &out) {
	string expr = req.str("expr");
	int timeout = req.integer("timeout", 3000, 100, 120000);
	int max_chars = req.integer("max_chars", 200000, 100, 10000000);
	bool store = req.boolean("store", false);
	bool preview = req.boolean("preview", !store);
	Opts op = make_opts(req.get("opts"));
	CALCULATOR->clearMessages();
	if(too_deeply_nested(expr)) return "式の入れ子が深すぎます";
	string uexpr = CALCULATOR->unlocalizeExpression(expr, op.eo.parse_options);
	// A live preview must not change anything: while "a = a + 1" is being typed it would
	// otherwise run again after every key press. It runs when "=" is pressed.
	if(preview) {
		bool deferred = expression_contains_save_function(uexpr, op.eo.parse_options);
		if(!deferred) {
			string from_str = uexpr, to_str;
			CALCULATOR->parseComments(from_str, op.eo.parse_options);
			CALCULATOR->separateToExpression(from_str, to_str, op.eo, true);
			MathStructure mparsed;
			CALCULATOR->beginTemporaryStopMessages();
			CALCULATOR->parse(&mparsed, from_str, op.eo.parse_options);
			CALCULATOR->endTemporaryStopMessages();
			deferred = changes_something(mparsed);
		}
		if(deferred) {
			CALCULATOR->clearMessages();
			out.str("result", "").str("parsed", "").boolean("approx", false).boolean("comparison", false)
			   .boolean("timeout", false).boolean("deferred", true).raw("messages", "[]");
			return "";
		}
	}
	CalcResult r;
	calculate_once(uexpr, timeout, op.eo, op.po, op.af, op.aa, r);
	string msgs = collect_messages();
	if(store && r.have_value && !r.timed_out) store_ans(r.value);
	if(r.forced) restart_after_reply = true;  // libqalculate state is not safe after a forced thread cancel
	bool truncated = truncate_utf8(r.result, (size_t) max_chars);
	truncate_utf8(r.parsed, 2000);
	out.str("result", r.result).str("parsed", r.parsed).boolean("approx", r.approx)
	   .boolean("comparison", r.comparison).boolean("timeout", r.timed_out).boolean("truncated", truncated)
	   .raw("messages", msgs);
	return "";
}

// Restore "ans" (the app saves its value and gives it back to a new engine process).
static string cmd_set_ans(const JVal &req, JOut &out) {
	string expr = req.str("expr");
	if(expr.empty()) return "expr missing";
	if(too_deeply_nested(expr)) return "式の入れ子が深すぎます";
	EvaluationOptions eo = default_user_evaluation_options;
	eo.parse_options.comma_as_separator = false;
	MathStructure m;
	bool ok = CALCULATOR->calculate(&m, expr, 3000, eo) && !m.isAborted();
	if(ok) vans[0]->set(m);
	CALCULATOR->clearMessages();
	out.boolean("set", ok);
	return "";
}

static double to_double(const MathStructure &m, bool &ok) {
	ok = false;
	if(m.isNumber() && m.number().isReal()) {
		double d = m.number().floatValue();
		if(std::isfinite(d)) { ok = true; return d; }
	}
	return 0;
}

static string cmd_plot(const JVal &req, JOut &out) {
	const JVal *exprs = req.get("exprs");
	if(!exprs || exprs->t != JVal::ARR) return "exprs missing";
	string var = req.str("var", "x");
	int steps = req.integer("steps", 300, 10, 4000);
	int timeout = req.integer("timeout", 8000, 100, 120000);
	if(exprs->a.size() > 12) return "too many expressions";
	Opts op = make_opts(req.get("opts"));
	EvaluationOptions eo = op.eo;
	eo.approximation = APPROXIMATION_APPROXIMATE;
	CALCULATOR->clearMessages();
	// the points are sent as doubles: do not compute them with up to 1000 digits
	int save_prec = CALCULATOR->getPrecision();
	if(save_prec > 20) CALCULATOR->setPrecision(20);
	long t0 = now_ms();
	// the range is user input too: evaluate it with a time limit
	MathStructure mmin, mmax;
	bool range_ok = !too_deeply_nested(req.str("min")) && !too_deeply_nested(req.str("max"))
	   && CALCULATOR->calculate(&mmin, CALCULATOR->unlocalizeExpression(req.str("min", "-10"), eo.parse_options), 2000, eo)
	   && CALCULATOR->calculate(&mmax, CALCULATOR->unlocalizeExpression(req.str("max", "10"), eo.parse_options), 2000, eo);
	bool ok1 = false, ok2 = false;
	double dmin = range_ok ? to_double(mmin, ok1) : 0, dmax = range_ok ? to_double(mmax, ok2) : 0;
	if(!ok1 || !ok2 || !(dmin < dmax)) { CALCULATOR->setPrecision(save_prec); collect_messages(); return "invalid range"; }
	string series = "[";
	for(size_t i = 0; i < exprs->a.size(); i++) {
		if(i) series += ",";
		string xs = "[", ys = "[";
		long left = timeout - (now_ms() - t0);  // one time budget for all series
		if(exprs->a[i].t == JVal::STR && !too_deeply_nested(exprs->a[i].s) && left >= 50) {
			MathStructure xv;
			MathStructure yv = CALCULATOR->expressionToPlotVector(CALCULATOR->unlocalizeExpression(exprs->a[i].s, eo.parse_options), mmin, mmax, steps, false, &xv, var, eo.parse_options, (int) left);
			if(yv.isVector() && xv.isVector()) {
				size_t n = yv.size() < xv.size() ? yv.size() : xv.size();
				for(size_t j = 0; j < n; j++) {
					bool okx, oky;
					double dx = to_double(xv[j], okx), dy = to_double(yv[j], oky);
					if(!okx) continue;
					if(xs.size() > 1) { xs += ","; ys += ","; }
					xs += jnum(dx);
					ys += oky ? jnum(dy) : "null";
				}
			}
		}
		xs += "]";
		ys += "]";
		series += "{\"x\":" + xs + ",\"y\":" + ys + "}";
	}
	series += "]";
	CALCULATOR->setPrecision(save_prec);
	out.raw("series", series).raw("messages", collect_messages());
	return "";
}

// A plotted value: a real number, also when rounding left a negligible imaginary part.
static bool plot_value(const MathStructure &m, double &d) {
	if(!m.isNumber() || m.number().includesInfinity()) return false;
	const Number &n = m.number();
	if(n.hasImaginaryPart()) {
		double re = n.realPart().floatValue(), im = n.imaginaryPart().floatValue();
		if(!std::isfinite(re) || !std::isfinite(im) || std::fabs(im) > 1e-12 * std::max(1.0, std::fabs(re))) return false;
		d = re;
		return true;
	}
	d = n.floatValue();
	return std::isfinite(d);
}

static string jnum12(double d) {
	if(!std::isfinite(d)) return "null";
	char buf[32];
	snprintf(buf, sizeof(buf), "%.12g", d);
	return buf;
}

// 3D plot: z = f(x, y) on a regular grid, nx columns (x) by ny rows (y). For each expression
// "z" holds the rows one after another (ny * nx values); a value that is not a real number
// (complex, undefined, infinite, with a unit) is null. One time budget for all expressions;
// when it runs out, the rest of the grid is null and "complete" is false.
static string cmd_plot3d(const JVal &req, JOut &out) {
	const JVal *exprs = req.get("exprs");
	if(!exprs || exprs->t != JVal::ARR || exprs->a.empty()) return "exprs missing";
	if(exprs->a.size() > 4) return "too many expressions";
	int nx = req.integer("nx", 41, 2, 121), ny = req.integer("ny", 41, 2, 121);
	int timeout = req.integer("timeout", 15000, 100, 120000);
	Opts op = make_opts(req.get("opts"));
	EvaluationOptions eo = op.eo;
	eo.approximation = APPROXIMATION_APPROXIMATE;
	eo.interval_calculation = INTERVAL_CALCULATION_NONE;
	eo.allow_complex = true;
	eo.parse_options.read_precision = DONT_READ_PRECISION;
	CALCULATOR->clearMessages();
	// the points are sent as doubles: do not compute them with up to 1000 digits
	int save_prec = CALCULATOR->getPrecision();
	if(save_prec > 20) CALCULATOR->setPrecision(20);
	long t0 = now_ms();
	// the ranges are user input too: evaluate them with a time limit
	const char *keys[4] = {"xmin", "xmax", "ymin", "ymax"};
	const char *defaults[4] = {"-5", "5", "-5", "5"};
	MathStructure lim[4];
	double d[4] = {0, 0, 0, 0};
	for(int k = 0; k < 4; k++) {
		string s = req.str(keys[k], defaults[k]);
		bool ok = false;
		if(!too_deeply_nested(s) && CALCULATOR->calculate(&lim[k], CALCULATOR->unlocalizeExpression(s, eo.parse_options), 2000, eo)) d[k] = to_double(lim[k], ok);
		if(!ok || (k % 2 == 1 && !(d[k - 1] < d[k]))) {
			CALCULATOR->setPrecision(save_prec);
			collect_messages();
			return k < 2 ? "invalid x range" : "invalid y range";
		}
	}
	Variable *vx = CALCULATOR->getActiveVariable("x"), *vy = CALCULATOR->getActiveVariable("y");
	MathStructure mx(vx ? vx : (Variable*) CALCULATOR->v_x), my(vy ? vy : (Variable*) CALCULATOR->v_y);
	// the grid: x values as generateVector() makes them, y values computed the same way
	MathStructure ystep(lim[3]);
	ystep.calculateSubtract(lim[2], eo);
	ystep.calculateDivide(ny - 1, eo);
	vector<MathStructure> yv(ny);
	string xs = "[", ys = "[";
	for(int i = 0; i < nx; i++) {
		if(i) xs += ",";
		xs += jnum12(i == nx - 1 ? d[1] : d[0] + (d[1] - d[0]) * i / (nx - 1));
	}
	for(int j = 0; j < ny; j++) {
		if(j == ny - 1) yv[j] = lim[3];
		else {
			yv[j] = ystep;
			yv[j].calculateMultiply(j, eo);
			yv[j].calculateAdd(lim[2], eo);
		}
		double y = 0;
		if(j) ys += ",";
		ys += plot_value(yv[j], y) ? jnum12(y) : "null";
	}
	xs += "]";
	ys += "]";
	string series = "[";
	for(size_t e = 0; e < exprs->a.size(); e++) {
		if(e) series += ",";
		string zs = "[";
		int done_rows = 0;
		long left = timeout - (now_ms() - t0);
		if(exprs->a[e].t == JVal::STR && !too_deeply_nested(exprs->a[e].s) && left >= 50) {
			MathStructure mparse;
			CALCULATOR->startControl((int) left);
			// syntax errors are reported; messages about single points are not
			CALCULATOR->parse(&mparse, CALCULATOR->unlocalizeExpression(exprs->a[e].s, eo.parse_options), eo.parse_options);
			CALCULATOR->beginTemporaryStopIntervalArithmetic();
			CALCULATOR->beginTemporaryStopMessages();
			for(int j = 0; j < ny && !CALCULATOR->aborted(); j++) {
				MathStructure row(mparse);
				row.replace(my, yv[j]);
				MathStructure zrow = row.generateVector(mx, lim[0], lim[1], nx, NULL, eo);
				if(CALCULATOR->aborted()) break;
				for(int i = 0; i < nx; i++) {
					double z = 0;
					if(j || i) zs += ",";
					zs += (zrow.isVector() && (size_t) i < zrow.size() && plot_value(zrow[i], z)) ? jnum12(z) : "null";
				}
				done_rows++;
			}
			CALCULATOR->endTemporaryStopMessages();
			CALCULATOR->endTemporaryStopIntervalArithmetic();
			CALCULATOR->stopControl();
		}
		for(int j = done_rows; j < ny; j++) {
			for(int i = 0; i < nx; i++) {
				if(j || i) zs += ",";
				zs += "null";
			}
		}
		zs += "]";
		series += "{\"z\":" + zs + ",\"complete\":" + (done_rows == ny ? "true" : "false") + "}";
	}
	series += "]";
	CALCULATOR->setPrecision(save_prec);
	out.raw("x", xs).raw("y", ys).raw("series", series).raw("messages", collect_messages());
	return "";
}

static string function_syntax(MathFunction *f) {
	string s = f->referenceName() + "(";
	int minargs = f->minargs(), maxargs = f->maxargs();
	int n = maxargs < 0 ? minargs + 1 : maxargs;
	if(n > 12) n = 12;
	for(int i = 1; i <= n; i++) {
		if(i > 1) s += ", ";
		Argument *arg = f->getArgumentDefinition(i);
		string an = arg ? arg->name() : "";
		if(an.empty()) an = "arg" + i2s(i);
		if(i > minargs) {
			string def = f->getDefaultValue(i);
			s += "[" + an;
			if(!def.empty() && def != "\"\"") s += "=" + def;
			s += "]";
		} else {
			s += an;
		}
	}
	if(maxargs < 0) s += ", …";
	s += ")";
	return s;
}

static string cmd_catalog(const JVal &req, JOut &out) {
	string kind = req.str("kind", "functions");
	string items = "[";
	bool first = true;
	if(kind == "functions") {
		for(size_t i = 0; i < CALCULATOR->functions.size(); i++) {
			MathFunction *f = CALCULATOR->functions[i];
			if(!f->isActive() || f->isHidden()) continue;
			if(!first) items += ",";
			first = false;
			JOut it;
			it.str("name", f->referenceName()).str("title", f->title(true)).str("category", f->category())
			  .str("description", f->description()).str("syntax", function_syntax(f)).boolean("local", f->isLocal());
			items += it.done();
		}
	} else if(kind == "variables") {
		for(size_t i = 0; i < CALCULATOR->variables.size(); i++) {
			Variable *v = CALCULATOR->variables[i];
			if(!v->isActive() || v->isHidden()) continue;
			if(!first) items += ",";
			first = false;
			JOut it;
			it.str("name", v->referenceName()).str("display", v->preferredDisplayName(false, true).name)
			  .str("title", v->title(true)).str("category", v->category()).str("description", v->description())
			  .boolean("local", v->isLocal());
			if(v->isKnown()) it.str("value", ((KnownVariable*) v)->expression());
			items += it.done();
		}
	} else if(kind == "units") {
		for(size_t i = 0; i < CALCULATOR->units.size(); i++) {
			Unit *u = CALCULATOR->units[i];
			if(!u->isActive() || u->isHidden()) continue;
			if(!first) items += ",";
			first = false;
			JOut it;
			it.str("name", u->referenceName()).str("abbr", u->preferredInputName(true, false).name)
			  .str("display", u->preferredDisplayName(true, true).name).str("title", u->title(true))
			  .str("category", u->category()).str("description", u->description())
			  .boolean("currency", u->isCurrency()).boolean("local", u->isLocal());
			items += it.done();
		}
	} else {
		return "unknown catalog kind";
	}
	items += "]";
	out.raw("items", items);
	return "";
}

static string cmd_rates_info(JOut &out) {
	string list = "[";
	for(int i = 1; i <= 3; i++) {
		string url = CALCULATOR->getExchangeRatesUrl(i);
		if(url.empty()) break;
		if(i > 1) list += ",";
		JOut it;
		it.num("index", i).str("url", url).str("file", CALCULATOR->getExchangeRatesFileName(i))
		  .num("time", (double) CALCULATOR->getExchangeRatesTime(i));
		list += it.done();
	}
	list += "]";
	mkdirs(getLocalDataDir());
	out.raw("sources", list).num("time", (double) CALCULATOR->getExchangeRatesTime());
	return "";
}

static string cmd_rates_reload(JOut &out) {
	CALCULATOR->clearMessages();
	bool ok = CALCULATOR->loadExchangeRates();
	out.boolean("loaded", ok).num("time", (double) CALCULATOR->getExchangeRatesTime()).raw("messages", collect_messages());
	return "";
}

// Calculator::saveDefinitions() overwrites the files in place (a kill or a full disk leaves a
// truncated file, and it reports success even when writing fails). Write a temporary file,
// flush it to disk and rename it over the old one.
static bool save_atomic(int (Calculator::*save)(const char*, bool), const string &path) {
	// not inside definitions/: loadLocalDefinitions() loads every file in that directory
	string tmp = buildPath(getLocalDataDir(), "." + path.substr(path.rfind('/') + 1) + ".tmp");
	if((CALCULATOR->*save)(tmp.c_str(), false) <= 0) {unlink(tmp.c_str()); return false;}
	FILE *f = fopen(tmp.c_str(), "r+");
	if(!f) return false;
	bool ok = fflush(f) == 0 && fsync(fileno(f)) == 0;
	fclose(f);
	return ok && rename(tmp.c_str(), path.c_str()) == 0;
}
static bool save_definitions() {
	string dir = buildPath(getLocalDataDir(), "definitions");
	recursiveMakeDir(dir);
	bool ok = save_atomic(&Calculator::saveFunctions, buildPath(dir, "functions.xml"));
	if(!save_atomic(&Calculator::saveVariables, buildPath(dir, "variables.xml"))) ok = false;
	if(!save_atomic(&Calculator::saveUnits, buildPath(dir, "units.xml"))) ok = false;
	if(!save_atomic(&Calculator::saveDataSets, buildPath(dir, "datasets.xml"))) ok = false;
	return ok;
}
// A definitions file that cannot be parsed would be silently ignored and then overwritten by
// the next save; keep it aside instead and tell the app.
static string defs_problem;
static void check_local_definitions() {
	string dir = buildPath(getLocalDataDir(), "definitions");
	const char *names[] = {"functions.xml", "variables.xml", "units.xml", "datasets.xml"};
	for(size_t i = 0; i < 4; i++) {
		string path = buildPath(dir, names[i]);
		if(!fileExists(path)) continue;
		xmlDocPtr doc = xmlReadFile(path.c_str(), NULL, XML_PARSE_NOERROR | XML_PARSE_NOWARNING);
		if(doc) {xmlFreeDoc(doc); continue;}
		string bakdir = buildPath(getLocalDataDir(), "broken-definitions");
		recursiveMakeDir(bakdir);
		string bak = buildPath(bakdir, string(names[i]) + "." + i2s((long int) time(NULL)));
		rename(path.c_str(), bak.c_str());
		if(!defs_problem.empty()) defs_problem += ", ";
		defs_problem += bak;
	}
}

static string cmd_define(const JVal &req, JOut &out, bool is_function) {
	string name = req.str("name");
	string value = req.str(is_function ? "expr" : "value");
	string title = req.str("title");
	remove_blank_ends(name);
	remove_blank_ends(value);
	if(name.empty() || value.empty()) return "名前と内容を入力してください";
	CALCULATOR->clearMessages();
	EvaluationOptions eo = default_user_evaluation_options;
	eo.parse_options.comma_as_separator = false;
	if(too_deeply_nested(value)) return "式の入れ子が深すぎます";
	{
		// refuse a value that libqalculate cannot read ("5 +* 3", "sin(")
		MathStructure mtest;
		CALCULATOR->parse(&mtest, CALCULATOR->unlocalizeExpression(value, eo.parse_options), eo.parse_options);
		string problem;
		for(CalculatorMessage *m = CALCULATOR->message(); m; m = CALCULATOR->nextMessage()) {
			if(problem.empty() && (m->type() == MESSAGE_ERROR || m->type() == MESSAGE_WARNING)) problem = m->message();
		}
		CALCULATOR->clearMessages();
		if(!problem.empty()) return "内容を確認してください（" + problem + "）";
	}
	if(is_function) {
		if(!CALCULATOR->functionNameIsValid(name)) return "関数名に使えない文字が含まれています";
		// functions have their own name space (a function "g" does not hide the unit g)
		MathFunction *existing = CALCULATOR->getActiveFunction(name, true);
		if(existing && (!existing->isLocal() || existing->subtype() != SUBTYPE_USER_FUNCTION)) return "「" + name + "」は組み込みの名前なので使えません";
		// same conversion as qalc's "function" command: 2x, πx, 2×x−y, √x ... -> \x, \y, \z
		string formula = value;
		fix_user_function_expression(formula, eo);
		if(CALCULATOR->hasToExpression(formula, false, eo)) return "関数の式に「to」は使えません";
		if(existing) {
			((UserFunction*) existing)->setFormula(formula);
			if(!title.empty()) existing->setTitle(title);
		} else {
			CALCULATOR->addFunction(new UserFunction("User functions", name, formula, true, -1, title));
		}
	} else {
		if(!CALCULATOR->variableNameIsValid(name)) return "変数名に使えない文字が含まれています";
		ExpressionItem *existing = CALCULATOR->getActiveVariable(name, true);
		if(!existing) existing = CALCULATOR->getActiveUnit(name, true);
		if(existing && (!existing->isLocal() || existing->type() != TYPE_VARIABLE || !((Variable*) existing)->isKnown())) return "「" + name + "」は組み込みの名前なので使えません";
		string expr = CALCULATOR->unlocalizeExpression(value, eo.parse_options);
		if(existing) {
			((KnownVariable*) existing)->set(expr);
			if(!title.empty()) existing->setTitle(title);
			if(existing->category() == CALCULATOR->temporaryCategory()) existing->setCategory("User variables");
		} else {
			CALCULATOR->addVariable(new KnownVariable("User variables", name, expr, title, true));
		}
	}
	bool saved = save_definitions();
	out.boolean("saved", saved).raw("messages", collect_messages());
	return "";
}

static string cmd_delete(const JVal &req, JOut &out) {
	string name = req.str("name");
	string kind = req.str("kind", "variable");
	ExpressionItem *item = kind == "function" ? (ExpressionItem*) CALCULATOR->getActiveFunction(name) : (ExpressionItem*) CALCULATOR->getActiveVariable(name);
	if(!item || !item->isLocal()) return "ユーザー定義の「" + name + "」が見つかりません";
	item->destroy();
	bool saved = save_definitions();
	out.boolean("saved", saved);
	return "";
}

static string cmd_user_defs(JOut &out) {
	string vars = "[", funcs = "[";
	bool fv = true, ff = true;
	for(size_t i = 0; i < CALCULATOR->variables.size(); i++) {
		Variable *v = CALCULATOR->variables[i];
		// "x = 5" / save() create Temporary variables: listed (they hide built-in names such as
		// the unknown x until the app is closed) and marked, but not saved to disk
		if(!v->isLocal() || !v->isActive() || !v->isKnown()) continue;
		if(!fv) vars += ",";
		fv = false;
		KnownVariable *kv = (KnownVariable*) v;
		JOut it;
		it.str("name", v->referenceName()).str("value", kv->isExpression() ? kv->expression() : print_input(kv->get())).str("title", v->title(false))
		  .boolean("temporary", v->category() == CALCULATOR->temporaryCategory());
		vars += it.done();
	}
	for(size_t i = 0; i < CALCULATOR->functions.size(); i++) {
		MathFunction *f = CALCULATOR->functions[i];
		if(!f->isLocal() || !f->isActive() || f->subtype() != SUBTYPE_USER_FUNCTION || f->category() == CALCULATOR->temporaryCategory()) continue;
		if(!ff) funcs += ",";
		ff = false;
		string formula = ((UserFunction*) f)->formula();
		gsub("\\x", "x", formula);
		gsub("\\y", "y", formula);
		gsub("\\z", "z", formula);
		JOut it;
		it.str("name", f->referenceName()).str("expr", formula).str("title", f->title(false));
		funcs += it.done();
	}
	vars += "]";
	funcs += "]";
	out.raw("variables", vars).raw("functions", funcs);
	return "";
}

// --------------------------------------------------------------------- main
int main() {
	new Calculator(true);
	mkdirs(getLocalDir());
	mkdirs(getLocalDataDir());
	CALCULATOR->loadExchangeRates();
	CALCULATOR->loadGlobalDefinitions();
	check_local_definitions();
	CALCULATOR->loadLocalDefinitions();
	CALCULATOR->clearMessages();
	// The phone's currency (from the app; the engine itself runs without a locale): currency
	// results are shown in it, as Qalculate! does with the local currency (100 USD = ¥15 688).
	const char *currency = getenv("QALC_CURRENCY");
	if(currency && *currency) {
		Unit *u = CALCULATOR->getActiveUnit(currency);
		if(u && u->isCurrency()) CALCULATOR->setLocalCurrency(u);
	}

	string ans_title[5] = {"Last Answer", "Answer 2", "Answer 3", "Answer 4", "Answer 5"};
	for(int i = 0; i < 5; i++) {
		string name = i == 0 ? "ans" : "ans" + i2s(i + 1);
		vans[i] = (KnownVariable*) CALCULATOR->addVariable(new KnownVariable(CALCULATOR->temporaryCategory(), name, m_undefined, ans_title[i], false, true));
	}

	int proto_fd = dup(1);
	if(proto_fd >= 0 && dup2(2, 1) >= 0) {
		FILE *f = fdopen(proto_fd, "w");
		if(f) proto = f;
	}

	std::ios::sync_with_stdio(false);
	std::set_terminate(on_terminate);
	std::thread(watchdog).detach();
	string line;
	while(std::getline(std::cin, line)) {
		if(line.empty()) continue;
		JVal req;
		JParser jp(line);
		JOut out;
		bool parsed_ok = jp.parse(req);
		if(parsed_ok) { jp.ws(); parsed_ok = jp.p == jp.e; }  // nothing may follow the object
		string id_json = "null";
		if(!parsed_ok || req.t != JVal::OBJ) {
			out.raw("id", "null").boolean("ok", false).str("error", "bad request");
		} else {
			const JVal *id = req.get("id");
			id_json = id && id->t == JVal::NUM ? jnum(id->n) : (id && id->t == JVal::STR ? jstr(id->s) : "null");
			out.raw("id", id_json);
			string cmd = req.str("cmd");
			if(cmd == "calc" || cmd == "plot" || cmd == "plot3d") {
				// Time limit + 3 s. libqalculate's own abort() would wait 5 s + ∛precision s and then
				// cancel the calculation thread, after which the engine must be restarted anyway;
				// answering and restarting sooner keeps the app responsive.
				std::lock_guard<std::mutex> lock(out_mutex);
				wd_id = id_json;
				wd_deadline = now_ms() + req.integer("timeout", cmd == "calc" ? 3000 : (cmd == "plot" ? 8000 : 15000), 100, 120000) + 3000;
			}
			string err;
			JOut body;
			try {
				if(cmd == "calc") err = cmd_calc(req, body);
				else if(cmd == "set_ans") err = cmd_set_ans(req, body);
				else if(cmd == "plot") err = cmd_plot(req, body);
				else if(cmd == "plot3d") err = cmd_plot3d(req, body);
				else if(cmd == "catalog") err = cmd_catalog(req, body);
				else if(cmd == "rates_info") err = cmd_rates_info(body);
				else if(cmd == "rates_reload") err = cmd_rates_reload(body);
				else if(cmd == "define_var") err = cmd_define(req, body, false);
				else if(cmd == "define_func") err = cmd_define(req, body, true);
				else if(cmd == "delete_def") err = cmd_delete(req, body);
				else if(cmd == "user_defs") err = cmd_user_defs(body);
				else if(cmd == "init") {
					body.str("engine", "libqalculate " QALC_ENGINE_VERSION).num("rates_time", (double) CALCULATOR->getExchangeRatesTime())
					    .boolean("ans_defined", !vans[0]->get().isUndefined());
					if(!defs_problem.empty()) body.str("defs_error", defs_problem);
				} else err = "unknown command";
			} catch(const std::exception &e) {
				// e.g. std::bad_alloc for gigantic results; libqalculate may be inconsistent now
				err = string("engine error: ") + e.what();
				body = JOut();
				restart_after_reply = true;
			}
			if(err.empty()) {
				out.boolean("ok", true);
				string b = body.done();
				if(b.size() > 2) { out.s += ","; out.s += b.substr(1, b.size() - 2); }
			} else {
				out.boolean("ok", false).str("error", err);
			}
			// the app starts a new engine for the next request
			if(restart_after_reply) out.boolean("restart", true);
		}
		write_line(out.done());
		if(g_ans_changed) {
			// "value" restores ans in a new engine process; "input" is for inserting the result
			// into an expression; the id is that of the calculation that produced it
			g_ans_changed = false;
			string ev = "{\"event\":\"ans\",\"id\":" + id_json + ",\"value\":" + jstr(vans[0]->get().print(CALCULATOR->save_printoptions))
			            + ",\"input\":" + jstr(print_input(vans[0]->get())) + "}";
			write_line(ev);
		}
		if(restart_after_reply) _exit(4);
	}
	// stdin closed: the app is gone. Exit at once without waiting for worker threads.
	fflush(proto);
	_exit(0);
}
