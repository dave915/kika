import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  Info,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, send } from "../api";
import type { Project } from "../types";
import { ErrorBox, Loading } from "./ui";
type AiUsage = {
  day: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  chargedTokens: number;
  pendingTokens: number;
  requests: number;
};
type AiStatus = {
  provider: "ollama";
  connected: boolean;
  message: string;
  models: {
    name: string;
    size: number;
    parameterSize: string;
    family: string;
  }[];
  defaultModel: string;
  config: {
    enabled: boolean;
    model: string;
    maxOutputTokens: number;
    dailyBudget: number;
    rateLimit: number;
  };
  usage: AiUsage;
};
type ChatResult = {
  provider: "ollama";
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
};
export function AiPanel({
  project: p,
  refresh,
  notify,
}: {
  project: Project;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [info, setInfo] = useState<AiStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [enabled, setEnabled] = useState(false),
    [model, setModel] = useState(""),
    [maxOutput, setMaxOutput] = useState(1024),
    [budget, setBudget] = useState(100000),
    [rate, setRate] = useState(60),
    [saving, setSaving] = useState(false),
    [prompt, setPrompt] = useState(
      "신규 입사자를 환영하는 짧은 인사말을 한국어로 작성해 주세요.",
    ),
    [generating, setGenerating] = useState(false),
    [answer, setAnswer] = useState<ChatResult | null>(null),
    [chatError, setChatError] = useState(""),
    [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null),
    loadSequence = useRef(0);
  const canManage = ["OWNER", "MANAGER"].includes(p.role || "");
  const load = useCallback(
    async (reset = true) => {
      const sequence = ++loadSequence.current;
      if (reset) setLoading(true);
      try {
        const data = await api<AiStatus>(`/manage/apps/${p.id}/ai`);
        if (sequence !== loadSequence.current) return;
        setInfo(data);
        setError("");
        if (reset) {
          setEnabled(data.config.enabled);
          setModel(data.config.model || data.defaultModel);
          setMaxOutput(data.config.maxOutputTokens);
          setBudget(data.config.dailyBudget);
          setRate(data.config.rateLimit);
        }
      } catch (e) {
        if (sequence === loadSequence.current) setError((e as Error).message);
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [p.id],
  );
  useEffect(() => {
    load();
    return () => {
      loadSequence.current++;
    };
  }, [load, p.version]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const dirty =
    !!info &&
    (enabled !== info.config.enabled ||
      model !== info.config.model ||
      maxOutput !== info.config.maxOutputTokens ||
      budget !== info.config.dailyBudget ||
      rate !== info.config.rateLimit);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await send(
        `/manage/apps/${p.id}/switches`,
        {
          llm_enabled: enabled,
          llm_mode: enabled ? "OLLAMA" : "NONE",
          ...(model ? { llm_model: model } : {}),
          llm_max_output_tokens: maxOutput,
          daily_budget: budget,
          rate_limit: rate,
        },
        "PUT",
        p.version,
      );
      await refresh();
      notify("Ollama AI 설정을 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function generate() {
    const abort = new AbortController();
    controller.current = abort;
    setGenerating(true);
    setChatError("");
    setAnswer(null);
    setCopied(false);
    try {
      const result = await api<{ result: ChatResult }>(
        `/manage/apps/${p.id}/ai/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: prompt }],
            maxOutputTokens: Math.min(512, info!.config.maxOutputTokens),
          }),
          signal: abort.signal,
        },
      );
      if (!abort.signal.aborted) setAnswer(result.result);
    } catch (e) {
      setChatError(
        abort.signal.aborted
          ? "응답 생성을 중지했어요. 사용량이 확인되지 않은 요청은 예약 예산으로 계산합니다."
          : (e as Error).message,
      );
    } finally {
      setGenerating(false);
      controller.current = null;
      load(false);
    }
  }
  if (loading && !info) return <Loading />;
  return (
    <div className="ai-panel">
      <div className="section-heading">
        <div>
          <h2>우리 프로젝트의 AI</h2>
          <p>Ollama 모델을 연결하고, 업무에 필요한 응답을 확인해 보세요.</p>
        </div>
        <button
          className="button secondary"
          disabled={loading || saving || generating}
          onClick={() => load()}
        >
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          연결 확인
        </button>
      </div>
      {error && <ErrorBox message={error} retry={() => load()} />}
      {info && (
        <>
          <div
            className={`ai-connection ${info.connected ? "connected" : "disconnected"}`}
          >
            <span className="ai-provider-icon">
              <Bot size={22} />
            </span>
            <div>
              <strong>
                Ollama <span>{info.connected ? "연결됨" : "연결 안 됨"}</span>
              </strong>
              <p>{info.message}</p>
            </div>
            {info.connected ? <Wifi size={18} /> : <WifiOff size={18} />}
          </div>
          <div className="ai-layout">
            <div className="ai-configuration">
              <div className="switch-row">
                <div>
                  <strong>AI 기능 사용</strong>
                  <p>이 프로젝트에서 Ollama 응답을 생성합니다.</p>
                </div>
                <button
                  className={`switch ${enabled ? "on" : ""}`}
                  role="switch"
                  aria-label="AI 기능 사용"
                  aria-checked={enabled}
                  disabled={!canManage || saving || generating}
                  onClick={() => setEnabled(!enabled)}
                >
                  <i />
                </button>
              </div>
              <label className="field-label">
                사용할 모델
                <select
                  aria-label="Ollama 모델"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={
                    !canManage || saving || generating || !info.connected
                  }
                >
                  <option value="">모델을 선택해 주세요</option>
                  {model && !info.models.some((m) => m.name === model) && (
                    <option value={model}>{model} · 현재 설치되지 않음</option>
                  )}
                  {info.models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                      {m.parameterSize ? ` · ${m.parameterSize}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-hint">
                서버에 설치된 로컬 대화 모델만 표시해요. API 키는 필요하지
                않습니다.
              </p>
              <div className="ai-limits">
                <label className="field-label">
                  최대 응답 길이
                  <select
                    aria-label="최대 응답 토큰"
                    value={maxOutput}
                    onChange={(e) => setMaxOutput(Number(e.target.value))}
                    disabled={!canManage || saving || generating}
                  >
                    {[128, 256, 512, 1024, 2048, 4096].map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString()} 토큰
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  일일 토큰 예산
                  <input
                    type="number"
                    aria-label="일일 AI 토큰 예산"
                    min={1000}
                    max={100000000}
                    step={1000}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    disabled={!canManage || saving || generating}
                  />
                </label>
              </div>
              <label className="field-label">
                사용자별 분당 요청 한도
                <input
                  type="number"
                  aria-label="AI 분당 요청 한도"
                  min={1}
                  max={1000}
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  disabled={!canManage || saving || generating}
                />
              </label>
              <div className="ai-budget">
                <div>
                  <span>오늘의 AI 사용량</span>
                  <strong>
                    {info.usage.totalTokens.toLocaleString()}{" "}
                    <small>토큰</small>
                  </strong>
                </div>
                <div className="usage-progress">
                  <i
                    style={{
                      width: `${Math.min(100, (info.usage.chargedTokens / info.config.dailyBudget) * 100)}%`,
                    }}
                  />
                </div>
                <p>
                  남은 예산{" "}
                  {Math.max(
                    0,
                    info.config.dailyBudget - info.usage.chargedTokens,
                  ).toLocaleString()}{" "}
                  · 진행·미확정분 포함 · 한국 시간 00:00 초기화
                </p>
              </div>
              {canManage ? (
                <div className="settings-footer">
                  <span className="muted">
                    {dirty
                      ? "변경 사항을 저장해 주세요."
                      : "설정이 저장되어 있어요."}
                  </span>
                  <button
                    className="button primary"
                    disabled={
                      saving ||
                      generating ||
                      !dirty ||
                      (enabled && (!info.connected || !model)) ||
                      budget < 1000 ||
                      budget > 100000000 ||
                      rate < 1 ||
                      rate > 1000
                    }
                    onClick={save}
                  >
                    {saving ? (
                      <LoaderCircle size={14} className="spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    AI 설정 저장
                  </button>
                </div>
              ) : (
                <div className="form-note">
                  <ShieldCheck size={16} />
                  <span>
                    모델과 예산은 프로젝트 소유자 또는 관리자가 변경할 수
                    있어요.
                  </span>
                </div>
              )}
            </div>
            <div className="ai-playground">
              <div className="section-heading">
                <div>
                  <h3>응답 테스트</h3>
                  <p>게시 전에도 선택한 모델을 직접 사용해 볼 수 있어요.</p>
                </div>
                <span className="neutral-tag">
                  {info.config.model || "모델 미설정"}
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  generate();
                }}
              >
                <label className="field-label">
                  AI에게 요청할 내용
                  <textarea
                    aria-label="AI 테스트 프롬프트"
                    rows={5}
                    maxLength={12000}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={generating}
                    placeholder="어떤 업무를 도와드릴까요?"
                  />
                </label>
                <div className="ai-prompt-footer">
                  <span>{prompt.length.toLocaleString()}자</span>
                  {generating ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => controller.current?.abort()}
                    >
                      <Square size={13} />
                      생성 중지
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      disabled={
                        !info.connected ||
                        !info.config.enabled ||
                        !prompt.trim() ||
                        dirty ||
                        !p.enabled
                      }
                      type="submit"
                    >
                      <Send size={14} />
                      응답 생성
                    </button>
                  )}
                </div>
              </form>
              {!info.config.enabled && (
                <div className="form-note">
                  <Info size={16} />
                  <span>
                    AI 기능을 켜고 모델을 저장하면 테스트할 수 있어요.
                  </span>
                </div>
              )}
              {chatError && <ErrorBox message={chatError} />}
              <div
                className={`ai-response ${generating ? "is-generating" : ""}`}
                aria-live="polite"
              >
                {generating ? (
                  <div className="ai-thinking" role="status">
                    <LoaderCircle size={23} className="spin" />
                    <strong>Ollama가 답변을 작성하고 있어요</strong>
                    <p>
                      모델을 처음 불러올 때는 시간이 조금 더 걸릴 수 있어요.
                    </p>
                  </div>
                ) : answer ? (
                  <>
                    <div className="ai-response-heading">
                      <span>
                        <Bot size={16} />
                        Ollama 응답
                      </span>
                      <button
                        className="icon-button"
                        aria-label="AI 응답 복사"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(answer.content);
                            setCopied(true);
                          } catch {
                            notify("응답을 복사하지 못했어요.", true);
                          }
                        }}
                      >
                        {copied ? <Check size={15} /> : <Copy size={15} />}
                      </button>
                    </div>
                    <div className="ai-answer">{answer.content}</div>
                    <div className="ai-response-meta">
                      <span>{answer.model}</span>
                      <span>
                        입력 {answer.usage.inputTokens} · 출력{" "}
                        {answer.usage.outputTokens} 토큰
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="ai-response-empty">
                    <Bot size={29} strokeWidth={1.4} />
                    <strong>작은 요청부터 시작해 보세요</strong>
                    <p>
                      공지 초안, 환영 인사, 설문 문항처럼
                      <br />
                      자주 쓰는 업무 문구를 만들어 보세요.
                    </p>
                  </div>
                )}
              </div>
              <p className="ai-privacy">
                <ShieldCheck size={13} />
                입력과 응답 본문은 플랫폼에 저장하지 않아요. 사용 모델과 토큰
                수만 기록합니다.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
