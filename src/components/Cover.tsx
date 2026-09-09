import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Check,
  Coffee,
  Heart,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
const people = ["하늘", "민지", "준호", "서연"];
export function Cover({
  kind,
  color,
  name,
}: {
  kind: string;
  color: string;
  name: string;
}) {
  return (
    <div className={`project-cover cover-${color}`} aria-hidden="true">
      {kind === "leave" ? (
        <div className="mini-window calendar-window">
          <div className="mini-window-header">
            <span>
              <span className="mini-logo mint">
                <CalendarDays size={10} />
              </span>
              우리팀 휴가 캘린더
            </span>
            <span className="mini-dots">•••</span>
          </div>
          <div className="mini-calendar-heading">
            <b>2026년 9월</b>
            <span>
              오늘 <span>‹　›</span>
            </span>
          </div>
          <div className="mini-week">
            {"월화수목금토일".split("").map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <div className="mini-calendar">
            {Array.from({ length: 21 }, (_, i) => (
              <span key={i} className={i === 9 ? "today" : ""}>
                {i + 1}
                {[2, 3, 9, 10, 16].includes(i) && (
                  <i
                    className={
                      i < 5 ? "cal-green" : i < 12 ? "cal-purple" : "cal-orange"
                    }
                  >
                    {i === 2
                      ? "하늘 연차"
                      : i === 9
                        ? "민지 반차"
                        : i === 16
                          ? "준호 연차"
                          : ""}
                  </i>
                )}
              </span>
            ))}
          </div>
        </div>
      ) : kind === "onboarding" ? (
        <div className="mini-onboarding">
          <span className="mini-pill">WELCOME TO THE TEAM</span>
          <h3>
            새로운 시작,
            <br />
            함께해서 반가워요 <span>✳</span>
          </h3>
          <p>우리와 함께할 여정을 시작해 볼까요?</p>
          <div className="onboarding-progress">
            <span>
              <b>나의 온보딩</b>
              <small>3 / 8 완료</small>
            </span>
            <i>
              <i />
            </i>
          </div>
          <div className="mini-check">
            <span>
              <Check size={9} /> 입사 서류 제출하기
            </span>
            <span>
              <Check size={9} /> 팀원들과 인사 나누기
            </span>
          </div>
        </div>
      ) : kind === "survey" ? (
        <div className="mini-survey">
          <div className="survey-orbits">
            <i />
            <i />
            <i />
          </div>
          <span className="mini-pill">YOUR VOICE MATTERS</span>
          <h3>
            더 나은 우리를 위한
            <br />
            작은 목소리
          </h3>
          <p>2026 조직문화 설문조사</p>
          <span className="mini-cta">
            설문 시작하기 <ArrowRight size={9} />
          </span>
          <small>약 5분 소요 · 익명 참여</small>
        </div>
      ) : kind === "review" ? (
        <div className="mini-review">
          <span>PEOPLE & GROWTH</span>
          <div>
            <h3>
              함께 돌아보고,
              <br />
              함께 성장하기.
            </h3>
            <ArrowUpRight size={42} strokeWidth={1.4} />
          </div>
          <p>2026 하반기 성과 평가 가이드</p>
          <footer>
            <span>평가 일정</span>
            <span>진행 절차</span>
            <span>자주 묻는 질문</span>
          </footer>
        </div>
      ) : kind === "hiring" ? (
        <div className="mini-window hiring-window">
          <div className="mini-window-header">
            <span>
              <Users size={10} /> 채용 현황
            </span>
            <Plus size={9} />
          </div>
          <div className="mini-stats">
            <span>
              진행 중인 채용
              <b>
                12<small>포지션</small>
              </b>
            </span>
            <span>
              이번 달 지원자
              <b>
                148<small>명</small>
              </b>
            </span>
          </div>
          <div className="mini-kanban">
            {["서류 검토", "인터뷰", "최종 합격"].map((s, i) => (
              <div key={s}>
                <b>
                  <i className={`kanban-${i}`} />
                  {s} <small>{6 - i}</small>
                </b>
                {Array.from({ length: i === 1 ? 2 : 3 }, (_, j) => (
                  <span key={j}>
                    <i />
                    <em />
                    <small>
                      {
                        [
                          "Product Designer",
                          "Frontend Developer",
                          "People Partner",
                        ][j]
                      }
                    </small>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : kind === "people" ? (
        <div className="mini-people">
          <span>MEET OUR PEOPLE</span>
          <h3>우리는 함께 일해요.</h3>
          <div className="mini-search">
            <Search size={9} /> 이름 또는 팀을 검색해 보세요
          </div>
          <div className="people-row">
            {people.map((p, i) => (
              <div key={p}>
                <span className={`person-portrait portrait-${i}`}>
                  <Users size={24} strokeWidth={1.4} />
                </span>
                <b>{p}</b>
                <small>{i < 2 ? "People Team" : "Product Team"}</small>
              </div>
            ))}
          </div>
        </div>
      ) : kind === "notice" ? (
        <div className="mini-notice">
          <div>
            <span>PEOPLE NEWS</span>
            <span>09</span>
          </div>
          <h3>
            새로운 소식,
            <br />
            놓치지 마세요.
          </h3>
          <div className="mini-notice-row">
            <span className="mini-tag">복지</span>
            <span>9월의 새로운 복지 안내</span>
            <ArrowUpRight size={10} />
          </div>
          <div className="mini-notice-row">
            <span className="mini-tag">안내</span>
            <span>추석 연휴 근무 안내</span>
            <ArrowUpRight size={10} />
          </div>
        </div>
      ) : kind === "lunch" ? (
        <div className="mini-lunch">
          <span className="lunch-symbol">
            <Coffee size={30} />
            <Heart size={15} />
          </span>
          <h3>오늘 점심, 같이 먹어요!</h3>
          <p>새로운 동료, 새로운 대화</p>
          <span className="mini-cta">
            런치 메이트 만나기 <ArrowRight size={9} />
          </span>
        </div>
      ) : (
        <div className="mini-custom">
          <Sparkles size={30} strokeWidth={1.3} />
          <h3>{name}</h3>
          <p>새로운 아이디어가 시작되는 곳</p>
          <span className="mini-outline">나의 업무 앱</span>
        </div>
      )}
    </div>
  );
}
