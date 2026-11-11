// 공연 뒤 출차 안내. data/days.json(분석 파이프라인 결과)을 읽어 쉬운 말로 바꿔 보여 준다.
const FEE_PER_10MIN = 600; // 올림픽공원 주차 요금: 10분당 600원, 10분 안에 나가면 무료 (기관 주차 안내 2026-11-10 확인)
const FREE_MIN = 10;
const WEEKDAYS = "월화수목금토일";
const WORD = { free: "원활", slow: "서행", jam: "정체", peak: "정체" }; // 도로 전광판 낱말
const BAR = { free: "#7b828c", slow: "#f5b800", jam: "#ff4d3d", peak: "#ff4d3d" };

const qs = new URLSearchParams(location.search);
const app = document.getElementById("app");
const data = await fetch("data/days.json").then((r) => r.json());
const { labels: L, step_min: STEP, start_hour: START_HOUR } = data.window;
const CAP5 = data.capacity_per_min * STEP; // 관측된 최대 처리량(5분당 대수)
const days = data.days;
const quick = Object.fromEntries(data.quick_by_level.map((q) => [q.level, q]));

// 공연장 조합으로 나눈 날의 유형 (분석의 concerts.day_type과 같은 이름)
const KIND = {
  dome_plus: "KSPO DOME과 다른 큰 공연장의 공연이 겹치는 날",
  dome: "KSPO DOME 공연만 있는 날",
  hall: "KSPO DOME 말고 다른 큰 공연장 공연만 있는 날",
};
const today = new Date().toLocaleDateString("sv-SE"); // 보는 사람 시계의 오늘, YYYY-MM-DD
// shortcut: 같은 조합의 지난 기록이 없는 날은 목록에서 뺀다. 2025년 기록을 받으면 조합이 늘어 거의 사라진다
const upcoming = data.upcoming.filter((u) => u.date >= today && data.types[u.type]);

const biggest = days.reduce((best, d, i) => (d.surge.peak_val > days[best].surge.peak_val ? i : best), 0);
const state = {
  on: upcoming.some((u) => u.date === qs.get("on")) ? qs.get("on") : !qs.has("day") && upcoming.length ? upcoming[0].date : null, // 고른 다가오는 공연 날
  day: qs.has("day") && days[+qs.get("day")] ? +qs.get("day") : biggest,
  role: qs.get("role") === "pickup" ? "pickup" : "driver",
  view: qs.get("view") === "board" ? "board" : "card",
  bin: null, // 전광판 보기의 시연용 시각
};
let first = true;

const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); // 공연 제목은 바깥 자료라 그대로 넣지 않는다
const short = (t) => (t.length > 24 ? t.slice(0, 23) + "…" : t);
const shows = (x) => x.concerts.map((c) => short(c.title)).join(", ");
// 다가오는 공연 날을 골랐으면 그날(u)과, 공연장 조합이 같은 지난 날 가운데 대표(d)를 함께 준다
function picked() {
  const u = state.on ? upcoming.find((x) => x.date === state.on) : null;
  return { u, d: u ? days.find((x) => x.date === data.types[u.type].rep) : days[state.day] };
}
const won = (n) => n.toLocaleString("ko-KR") + "원";
const ceil10 = (m) => Math.ceil(m / 10) * 10;
const spoken = (label) => {
  const [h, m] = label.split(":").map(Number);
  const part = h < 6 ? "새벽" : h < 12 ? "오전" : h < 18 ? "오후" : "밤";
  return `${part} ${h % 12 || 12}시${m ? ` ${m}분` : ""}`;
};
const dayName = (d) => {
  const [, m, dd] = d.date.split("-").map(Number);
  return `${m}월 ${dd}일 ${WEEKDAYS[d.weekday]}요일`;
};

// 출구가 얼마나 붐비는지: 그 구간과 다음 구간의 출차를 처리량에 견준다 (분석의 quick.by_flow_level과 같은 기준)
function level(d, bin) {
  const share = ((d.out[bin] || 0) + (d.out[bin + 1] || 0)) / 2 / CAP5;
  return share >= data.levels.peak ? "peak" : share >= data.levels.jam ? "jam" : share >= data.levels.slow ? "slow" : "free";
}
// 세 선택: 가장 막힐 때, 중간, 붐빔이 끝난 뒤. 주차비가 딱 떨어지게 10분 단위로 잡는다.
function offsets(d) {
  const last = Math.max(20, ceil10((d.busy.clear - d.surge.peak) * STEP));
  return [0, Math.max(10, Math.round(last / 20) * 10), last];
}
const minutesOut = (lv) => (quick[lv] && quick[lv].stay_median !== null ? Math.round(quick[lv].stay_median) : null);
const gonePhrase = (d, off) => {
  const i = Math.min(d.busy.cum.length - 1, Math.max(0, d.surge.peak - d.busy.start + off / STEP));
  const g = Math.round(d.busy.cum[i] / 10);
  if (g <= 0) return "붐비는 시간에 나갈 차가 아직 거의 다 남아 있을 때예요.";
  if (g >= 10) return "붐비는 시간에 나갈 차가 다 빠져나간 뒤예요.";
  return `붐비는 시간에 나간 차 10대 중 ${g}대가 빠져나간 뒤예요.`;
};

function driverView(d, that) {
  const offs = offsets(d), last = offs[2];
  const atPeak = minutesOut(level(d, d.surge.peak)), after = minutesOut("free");
  const mild = atPeak !== null && after !== null && atPeak - after <= 2;
  const answer = mild
    ? `${that} 가장 붐빌 때도 잠깐 들른 차가 ${atPeak}분이면 나왔어요. 기다리지 않아도 괜찮았어요.`
    : `가장 막힐 때를 피해 ${last}분 기다리면 한산해졌어요. 주차비는 <span class="money">${won((last / 10) * FEE_PER_10MIN)} 더</span> 들어요.`;
  const stops = offs.map((off) => {
    const lv = level(d, d.surge.peak + off / STEP), m = minutesOut(lv);
    return `<li class="stop">
      <h2>${off === 0 ? "가장 막힐 때 출발" : `${off}분 더 있다 출발`}<span class="vms ${lv}">${WORD[lv]}</span></h2>
      <p class="big ${off ? "costly" : ""}">${off ? `주차비 ${won((off / 10) * FEE_PER_10MIN)} 더` : "주차비 그대로"}</p>
      ${m !== null ? `<p>이만큼 붐빌 때 잠깐 들른 차는 나오는 데 ${m}분쯤 걸렸어요.</p>` : ""}
      <p class="note">${gonePhrase(d, off)}</p>
    </li>`;
  });
  return { answer, stops };
}

function pickupView(d, that) {
  const offs = offsets(d), last = offs[2];
  const atPeak = minutesOut(level(d, d.surge.peak)), after = minutesOut("free");
  const answer = atPeak === null || after === null
    ? "이만큼 붐빈 날의 기록이 아직 적어요."
    : atPeak > FREE_MIN
      ? `가장 막힐 때 들어가면 나오는 데 ${atPeak}분쯤 걸렸어요. ${last}분 늦게 가면 ${after}분쯤이라 <span class="money">주차비 없이</span> 나올 수 있었어요.`
      : `${that} 가장 붐빌 때 들어가도 ${atPeak}분쯤이면 나왔어요. ${FREE_MIN}분 안이라 주차비가 없는 편이에요.`;
  const stops = offs.map((off) => {
    const lv = level(d, d.surge.peak + off / STEP), m = minutesOut(lv);
    return `<li class="stop">
      <h2>${off === 0 ? "가장 막힐 때 도착" : `${off}분 늦게 도착`}<span class="vms ${lv}">${WORD[lv]}</span></h2>
      ${m === null
        ? `<p class="big">기록이 적어 알 수 없어요</p>`
        : `<p class="big ${m > FREE_MIN ? "costly" : ""}">들어갔다 나오는 데 ${m}분쯤</p>
           <p>${m > FREE_MIN ? `${FREE_MIN}분을 넘겨 주차비가 붙기 쉬워요.` : `${FREE_MIN}분 안에 나와 주차비가 없는 편이에요.`}</p>`}
    </li>`;
  });
  return { answer, stops, extra: `<p class="note">${FREE_MIN}분 안에 나가면 무료, 넘기면 10분마다 ${won(FEE_PER_10MIN)}이에요.</p>` };
}

function chart(d) {
  const from = (18 - START_HOUR) * 60 / STEP, to = (25 - START_HOUR) * 60 / STEP; // 18:00~01:00
  const W = 420, H = 190, P = { l: 30, r: 6, t: 10, b: 24 };
  const bw = (W - P.l - P.r) / (to - from);
  const max = Math.max(...d.out.slice(from, to)) * 1.08;
  const x = (i) => P.l + (i - from) * bw, y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  let g = "";
  for (let v = 0; v <= max; v += 50) {
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#3a4049"/><text x="${P.l - 5}" y="${y(v) + 4}" font-size="10" fill="#a9adb3" text-anchor="end">${v}</text>`;
  }
  for (let i = from; i < to; i++) {
    g += `<rect x="${(x(i) + 0.6).toFixed(1)}" y="${y(d.out[i]).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${(H - P.b - y(d.out[i])).toFixed(1)}" fill="${BAR[level(d, i)]}"/>`;
  }
  g += `<polyline fill="none" stroke="#f3f2ec" stroke-width="1.5" stroke-dasharray="4 3" points="${d.base_out.slice(from, to).map((v, k) => `${(x(from + k) + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
  for (let i = from; i < to; i += 60 / STEP) g += `<text x="${x(i)}" y="${H - 7}" font-size="10" fill="#a9adb3">${L[i]}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${dayName(d)} 저녁 5분마다 나간 차 수. ${L[d.busy.start]}부터 ${L[d.busy.clear]}까지 붐볐다.">${g}</svg>`;
}

function proof(d) {
  const row = (lv, name) => {
    const q = quick[lv];
    return `<dt>${name}</dt><dd>${q.stay_median === null ? "기록 적음" : `${Math.round(q.stay_median)}분`} (${q.n.toLocaleString("ko-KR")}대, ${q.days}일)</dd>`;
  };
  const usual = d.base_days > 0
    ? `공연 없는 ${WEEKDAYS[d.weekday]}요일 ${d.base_days}일의 가운데 값`
    : `7월의 ${WEEKDAYS[d.weekday]}요일은 모두 행사 날이라, 가장 한산했던 값`;
  return `<details class="proof">
    <summary>근거 보기</summary>
    ${chart(d)}
    <div class="legend"><span><i style="background:${BAR.jam}"></i>정체</span><span><i style="background:${BAR.slow}"></i>서행</span><span><i style="background:${BAR.free}"></i>원활</span><span><i style="background:#f3f2ec"></i>평소</span></div>
    <dl>
      <dt>기록한 날</dt><dd>2024년 ${dayName(d)}</dd>
      ${d.concerts.length ? `<dt>그날 공연</dt><dd>${d.concerts.map((c) => `${esc(short(c.title))} (${c.venue})`).join("<br>")}</dd>` : ""}
      <dt>붐빈 시간</dt><dd>${L[d.busy.start]}~${L[d.busy.clear]} (${(d.busy.clear - d.busy.start) * STEP}분)</dd>
      <dt>그 시간에 나간 차</dt><dd>${d.busy.cars.toLocaleString("ko-KR")}대</dd>
      <dt>가장 붐빈 5분</dt><dd>${L[d.surge.peak]}, ${d.surge.peak_val}대</dd>
      <dt>출구가 가장 많이 내보낸 때</dt><dd>1분에 약 ${Math.round(data.capacity_per_min)}대</dd>
    </dl>
    <p class="fine">정체는 출구가 가장 많이 내보낸 때의 70% 이상, 서행은 40% 이상으로 나가던 때예요. 평소 선은 ${usual}이에요.</p>
    <dl>
      <dt>잠깐 들른 차가 나오는 데 걸린 시간</dt><dd></dd>
      ${row("peak", "가장 붐빌 때 (85% 이상)")}${row("jam", "정체 (70~85%)")}${row("slow", "서행")}${row("free", "원활")}
    </dl>
    <p class="fine">공공데이터포털에 공개된 한국체육산업개발 올림픽공원 입출차 정보(2024년 7월, 215,528건)로 계산했어요. 지난 기록이라 오늘은 다를 수 있어요. 세 문을 합친 값이에요. "잠깐 들른 차"는 한 시간 안에 나간 차 전부라서, 데리러 온 차만 고른 값은 아니에요. 가장 붐빌 때의 기록은 ${quick.peak.days}일 치 ${quick.peak.n}대뿐이라 달라질 수 있어요. 공연 일정과 공연장은 공연정보(통합) 자료에서 가져왔고, 공연 기간 안의 모든 날에 공연이 있다고 봤어요. 공연장 조합이 같은 날은 2024년 7월에 2~4일씩뿐이에요. 주차비는 10분당 ${won(FEE_PER_10MIN)}으로 셈했어요.</p>
  </details>`;
}

function card(d, u) {
  const v = (state.role === "driver" ? driverView : pickupView)(d, u ? "비슷했던 날은" : "이날은");
  const past = days.map((x, i) => `<option value="day:${i}" ${!u && i === state.day ? "selected" : ""}>${dayName(x)} · ${esc(shows(x)) || `가장 붐빈 5분에 ${x.surge.peak_val}대`}</option>`).join("");
  const next = upcoming.map((x) => `<option value="on:${x.date}" ${u === x ? "selected" : ""}>${dayName(x)} · ${esc(shows(x))}</option>`).join("");
  const kind = u && data.types[u.type];
  const event = u ? `<div class="event">
      <p class="event-day">${dayName(u)}</p>
      <ul>${u.concerts.map((c) => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a> <span>${c.venue}</span></li>`).join("")}</ul>
      <p class="kind">${KIND[u.type]}이에요. 2024년 7월의 이런 날 ${kind.days.length}일은 나가는 길이 ${Math.min(...kind.busy_min) === Math.max(...kind.busy_min) ? "" : `${Math.min(...kind.busy_min)}~`}${Math.max(...kind.busy_min)}분 동안 붐볐어요.</p>
    </div>` : "";
  return `<h1 class="road-title"><span>지금 나갈까</span><span>기다릴까</span></h1>
    <p class="lede">올림픽공원 주차장에서 공연이 끝난 뒤 나가는 길을 지난 기록으로 알려 드려요.</p>
    <div class="roles" role="group" aria-label="누구인지 고르기">
      <button type="button" data-role="driver" aria-pressed="${state.role === "driver"}">차를 가져왔어요</button>
      <button type="button" data-role="pickup" aria-pressed="${state.role === "pickup"}">데리러 가요</button>
    </div>
    <label class="pick"><span>공연 날 고르기</span><select id="day">
      ${next ? `<optgroup label="다가오는 공연">${next}</optgroup>` : ""}
      <optgroup label="지난 기록 다시 보기 (2024년 7월)">${past}</optgroup>
    </select></label>
    ${event}
    <p class="answer">${v.answer}</p>
    <p class="when">${u ? `가장 비슷했던 2024년 ${dayName(d)}에는` : `${dayName(d)}에는`} ${spoken(L[d.busy.start])}부터 ${spoken(L[d.busy.clear])}까지 붐볐고, ${spoken(L[d.surge.peak])} 무렵이 가장 막혔어요.${u ? " 공연이 끝나는 시각에 따라 시각은 달라져요." : ""}</p>
    ${v.extra || ""}
    <ol class="lane">${v.stops.join("")}</ol>
    ${proof(d)}`;
}

function board(d) {
  const lo = Math.max(0, d.busy.start - 6), hi = Math.min(d.out.length - 2, d.busy.clear + 6);
  if (state.bin === null) state.bin = d.surge.peak;
  const lv = level(d, state.bin);
  const left = (d.busy.clear - state.bin) * STEP;
  const line = state.bin < d.busy.start
    ? `곧 나가는 차가 몰려요. 지난 비슷한 날은 ${spoken(L[d.busy.start])}부터였어요.`
    : left > 0
      ? `약 ${left}분 뒤 한산해져요. 기다리면 주차비 <span class="money">${won((ceil10(left) / 10) * FEE_PER_10MIN)} 더</span>.`
      : "지금 나가도 좋아요.";
  return `<div class="board-plate">
      <div class="board-head"><span>올림픽공원 주차장 나가는 길</span><span>${L[state.bin]}</span></div>
      <div class="board-word ${lv}">${WORD[lv]}</div>
      <p class="board-line">${line}</p>
    </div>
    <label class="board-ctl">시연용 시각 <input id="scrub" type="range" min="${lo}" max="${hi}" value="${state.bin}"></label>
    <p class="fine">${dayName(d)} 기록을 그 시각의 화면처럼 보여 주는 시연이에요. 실시간 값이 아니에요.</p>`;
}

function render() {
  const { d, u } = picked();
  document.body.className = [state.view === "board" ? "board" : "", first ? "first" : ""].join(" ").trim();
  app.innerHTML = state.view === "board" ? board(d) : card(d, u);
  history.replaceState(null, "", `?${state.on ? `on=${state.on}` : `day=${state.day}`}&role=${state.role}${state.view === "board" ? "&view=board" : ""}`);
}

app.addEventListener("click", (e) => {
  const b = e.target.closest("[data-role]");
  if (!b) return;
  state.role = b.dataset.role; first = false; render();
  app.querySelector(`[data-role="${state.role}"]`).focus();
});
app.addEventListener("change", (e) => {
  if (e.target.id !== "day") return;
  const [kind, value] = e.target.value.split(":");
  if (kind === "on") state.on = value; else { state.on = null; state.day = +value; }
  state.bin = null; first = false; render();
  document.getElementById("day").focus();
});
app.addEventListener("input", (e) => {
  if (e.target.id !== "scrub") return;
  state.bin = +e.target.value; first = false; render();
  document.getElementById("scrub").focus();
});
render();
