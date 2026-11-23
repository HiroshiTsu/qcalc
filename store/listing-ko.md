# QCalc — Google Play store listing (Korean)

The texts to add in Play Console as a translation: "Grow users" → "Store presence" → "Main store listing"
→ "Manage translations" → add **Korean – ko-KR** and paste the texts below.
The default language of the listing stays English (listing-en.md). Decimal point, 부가세 10 %, won.
Limits: app name 30 characters, short description 80, full description 4000; checked by
store/tools/listing_check.py; the same texts are in store/play-import/ko-KR/ (1.12.0, stage M).
Written by Claude (not checked by a native speaker yet; store/launch-plan-ja.md says what testers should look at).

- Screenshots: store/screenshots-1.14/ko/. Feature graphic: store/feature-graphic-1.14-ko.png.
- App icon: store/icon-512.png.

<!-- listing: ko-KR -->
## 한국어 (ko-KR)

### App name

QCalc - 공학용 계산기·단위 변환

### Short description

수식을 쓰는 그대로 입력해 계산. 단위·환율 변환, 부가세·대출 계산, 그래프와 회전체 부피까지.

### Full description

종이에 쓰듯 수식을 그대로 입력하면 계산되는 공학용 계산기입니다. 단위·환율 변환, 가격과 대출 계산, 방정식, 그래프, 회전체의 부피까지 앱 하나로 해결할 수 있습니다.
예: "100 km/h to mph", "solve(x^2 − 5x + 6 = 0)", "3/8 + 1/6". 답을 분수, 루트, π가 들어간 정확한 형태로도 볼 수 있습니다.

■ 학생과 선생님을 위해
• 함수 그래프를 그리고 손가락으로 이동·확대. 도함수, 접선, 영점, 극값, 넓이를 그래프 위에 바로 표시
• 두 그래프로 둘러싸인 부분을 "⟳ 3D"로 회전체로 만들고 부피를 바로 확인. 축은 탭해서 바꿀 수 있습니다. 원판·원통 껍질 선, 파푸스-굴딘 정리, 단면이 정사각형·삼각형·반원인 입체도
• 방정식과 연립방정식, 미분·적분·극한·급수, 행렬(30 × 30까지), 복소수, 2·8·16진수
• 평균, 중앙값, 표준편차, 사분위수, 회귀 직선과 그래프
• 최대 20만 자리 계산(1,000자리를 넘는 계산은 QCalc Pro)

■ GPU로 그리는 실물 같은 3D (QCalc Pro)
• 실물 같은 빛과 그림자, 금속과 액체도 실물처럼 보입니다
• 모든 3D에서 ‘투명’: 불투명도를 바꾸고, 어느 식·어느 부분을 투명하게 할지 고를 수 있습니다(탱크의 ‘용기’만 등)
• 손가락 하나로 어느 방향으로든 돌릴 수 있고, ‘정면’·‘위’·‘옆’으로 바로 바꿀 수 있습니다
• QCalc Pro 없이도 3D를 한 번 무료로 열 수 있습니다

■ 현장과 설계 업무를 위해
• 도형 22가지의 넓이와 부피, 탱크의 액량(액면 높이 ⇄ 양), 측정한 단면으로 부피, 밀도로 무게(재료는 스테인리스강·알루미늄·구리·황동·나무·PLA·ABS·아크릴 등)
• 단위를 붙인 채로 계산(2.4 m × 1.8 m × 0.15 m to L, 3/4 in to mm), 오차 전파
• QCalc Pro: 도형과 용기의 3D(액면 끌기), 탱크 경판(반구형·반타원형·접시형)과 조견표, 윤곽(위치와 지름)으로 회전체의 부피·용량·무게, 3D 프린터용 STL 파일, 표를 CSV로 저장

■ 장보기와 가계부를 위해
• 가격(할인과 부가세 10 %), 퍼센트, 단가 비교, 더치페이, 대출의 월 상환액과 상환표, 적금, 날짜(○일 후, 나이), 시간(근무 시간과 급여)
• 환율 변환(환율은 유럽중앙은행 등에서 받아옵니다)
• 계산 메모: 한 줄씩 계산하고 합계. "월세 = 650000 KRW"처럼 이름도 붙일 수 있습니다. .txt·.csv 파일이나 다른 앱에서 공유한 텍스트도 읽어 들일 수 있습니다

■ 쓰기 쉽게
• 모든 도구에 예시가 있어 탭하면 바로 결과가 나옵니다. 결과를 탭하면 입력 줄에 넣기, 기록에 남기기, 복사를 고를 수 있습니다
• 보기 쉬운 결과: 유효숫자 15자리, 세 자리마다 구분, ‘= 정확한 값’과 ‘≈ 근삿값’의 두 줄 표시. 자릿수는 위쪽의 ‘15자리’ 버튼으로 바로 바꿀 수 있습니다
• 도구 화면마다 결과를 몇 자리로 표시할지 고를 수 있습니다(화면 제목 오른쪽의 ⋯ → ‘표시 자릿수…’)
• 기록의 줄을 그 자리에서 고치기, 검색·고정·메모·선택한 줄의 합계, 메모리 키
• 홈 화면 위젯, 빠른 설정 타일
• 그래프를 이미지로 공유
• 한국어, 영어, 일본어, 스페인어, 독일어, 프랑스어, 중국어(번체) 화면. 사용 설명서도 앱 안에서 읽을 수 있고 인터넷 없이도 열립니다. 각 화면의 "?"를 누르면 그 설명이 열립니다

■ QCalc Pro (앱 내 1회 구매)
3D(GPU로 그리는 빛과 그림자, ‘투명’, 어느 방향으로든 돌리는 3D 그래프. 곡면의 부피와 겉넓이, 회전체·도형·용기의 3D 표시, 움직이는 GIF), 1,000자리를 넘는 계산, 탱크 경판과 조견표, 윤곽으로 회전체, STL, 표와 기록의 CSV, 색상 테마, 두 번째부터의 계산 메모. 구독이 아닙니다. 공부와 일상에 쓰는 기능은 구매하지 않아도 모두 쓸 수 있습니다. 가격은 Google Play 구매 화면에 표시됩니다.

■ 안심하고 쓸 수 있도록
• 광고가 없고 구독도 없습니다.
• 모든 계산은 휴대폰 안에서 합니다. 인터넷은 환율을 받아올 때만 쓰며, 계산·그래프·설명서는 인터넷 없이도 됩니다.
• 개인정보를 수집하지 않고 개발자에게 아무것도 보내지 않습니다. 기록과 설정은 휴대폰 안에만 저장됩니다.
• 오픈 소스(GNU GPL v2 이상): https://github.com/HiroshiTsu/qcalc
• 계산 엔진으로 오픈 소스 libqalculate(Qalculate!의 계산 엔진)를 씁니다. QCalc는 Qalculate! 개발자와 관계없는 개인이 만들었습니다.

■ 주의
계산 결과는 참고값입니다. 거래·증명, 설계·시공, 세금 신고 등에는 쓰지 말고, 중요한 결과는 공식 방법으로 확인하세요.

■ 문의
버그·요청: hiroshitsu.apps@gmail.com
사용 설명서(사진·PDF): https://hiroshitsu.github.io/qcalc/manual/
Android 7.0 이상, 64비트 ARM(arm64) 기기에서 작동합니다.
<!-- /listing -->

## 버전 노트

The release notes of 1.10.0 in Korean (ko-KR) are in listing-en.md under "Release notes", together with
the other languages: paste all the blocks into the field in Play Console.
