import Anthropic from '@anthropic-ai/sdk'
import type { BriefingInput } from '../../../shared/briefingInput'
import type { Ymd } from '../../../shared/types'
import type { Attachment, DinnerInput, JournalInput, MenuInput, QuickAddInput, WeeklyInput } from './inputs'
import {
  briefingSchema, dinnerSchema, extractionSchema, InvalidOutputError, journalSchema, menuSchema, quickAddSchema,
  validateBriefing, validateDinner, validateExtraction, validateJournal, validateMenu, validateQuickAddRaw,
  type BriefingResult, type DinnerResult, type JournalResult, type KidsnoteExtraction, type MenuExtraction, type RawQuickAdd,
} from './schemas'

/** Briefings, weekly preview, growth journal, notice and photo extraction. */
export const CLAUDE_MODEL = 'claude-sonnet-5-5'
/** Quick add and dinner ideas: short, frequent calls. Haiku has no server-side fallback, so its refusals fail the call. */
export const CLAUDE_FAST_MODEL = 'claude-haiku-5-5'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export type Effort = 'low' | 'medium'

export interface KidsnoteReportInput {
  text: string
  written: Ymd // KST date the notice was written
  /** Event keywords covered by the household's own prep rules: Claude must not infer items for these. */
  ruleKeywords: string[]
  /** Photos / PDFs attached to the notice, or a newsletter file uploaded by a member. */
  attachments?: Attachment[]
  /** Center notices only: the child's class and the other classes, so items meant only for other classes are left out. */
  audience?: { myClass: string; otherClasses: string[] }
}

type WithModel<T> = T & { model: string }

export interface ClaudePort {
  writeBriefing(input: BriefingInput): Promise<WithModel<BriefingResult>>
  extractKidsnote(report: KidsnoteReportInput): Promise<WithModel<KidsnoteExtraction>>
  quickAdd(input: QuickAddInput): Promise<WithModel<RawQuickAdd>>
  writeWeekly(input: WeeklyInput): Promise<WithModel<BriefingResult>>
  writeJournal(input: JournalInput): Promise<WithModel<JournalResult>>
  suggestDinner(input: DinnerInput): Promise<WithModel<DinnerResult>>
  extractMenu(input: MenuInput): Promise<WithModel<MenuExtraction>>
}

export class ClaudeRefusalError extends Error {}

// Prompts are instructions for Claude, not user-facing copy.
export const BRIEFING_SYSTEM = `당신은 부부가 함께 쓰는 집안 살림 앱 「살뜰」의 브리핑 작성자입니다.
입력 JSON(오늘 살림 자료)만 보고 두 사람에게 보낼 짧은 브리핑을 씁니다.

규칙:
- 따뜻하고 짧은 해요체로 씁니다. 과장, 감탄사 남발, 이모지, 줄표(—)는 쓰지 않습니다.
- headline: 한 줄 요약(30자 안팎). 홈 화면과 알림 제목 아래에 그대로 나옵니다.
- lines: 최대 6줄. 한 줄에 한 가지만, 40자 안팎으로 씁니다. 중요한 것(시간이 정해진 일정, 준비물, 비 예보, 밀린 일)부터 씁니다.
- slot이 morning이면 오늘(focusDay) 이야기, evening이면 내일(focusDay) 준비와 오늘 남은 일(todayLeft, routinesLeft)을 다룹니다.
- 사람을 부를 때는 names에 있는 이름을 그대로 씁니다. owner가 both면 「함께」로 씁니다. 이름이 빈 문자열이면 이름 없이 씁니다.
- prepItems 가운데 source가 inferred인 것은 「(추천)」을 붙여 추천이라고 밝힙니다. rule·stated는 그냥 씁니다.
- 입력에 없는 일정, 숫자, 날짜, 장소, 사람을 지어내지 않습니다. 날씨는 weather 값이 있을 때만 말합니다.
- 할 말이 거의 없으면 lines를 1~2줄로 짧게 둡니다.`

export const EXTRACT_SYSTEM = `당신은 어린이집·유치원 알림장(키즈노트)에서 부모가 챙길 정보를 뽑는 도우미입니다.
알림장 본문과 작성일(written, YYYY-MM-DD, 한국 날짜)을 받아 JSON으로만 답합니다.
이미지나 PDF(가정통신문, 안내문 사진, 식단표 등)가 함께 오면 그 안의 글도 알림장 본문으로 읽습니다. 본문(text)이 비어 있으면 첨부만 읽습니다.

- events: 아이가 참여하는 일정(소풍, 행사, 수업, 휴원, 검진 등). 날짜가 없는 일반 안내는 넣지 않습니다.
  - title: 짧은 일정 이름(예: 「가을 소풍」). 아이 이름이나 기관 이름은 넣지 않습니다.
  - dateText: 본문에 적힌 날짜 표현을 그대로(예: 「다음 주 수요일」, 「11월 5일」, 「내일」). 없으면 빈 문자열.
  - isoDate: 작성일 기준으로 확실히 계산되는 경우에만 YYYY-MM-DD. 애매하면 null.
  - time: 본문에 시각이 있으면 24시간제 HH:mm, 없으면 null.
  - prepItems: 본문에 적힌 준비물은 source "stated". 적혀 있지 않지만 일정에 꼭 필요해 보이는 것만 source "inferred"로 최대 3개.
    ruleKeywords에 든 낱말이 일정 제목에 들어가면 그 일정에는 inferred를 넣지 않습니다(집에서 정한 규칙이 따로 있음).
    needsPurchase는 새로 사야 할 가능성이 큰 소모성 물건(예: 견학용 우비, 행사용 흰 티셔츠)일 때만 true.
- deadlines: 회신·제출·납부 마감(예: 「동의서 제출」). dateText·isoDate 규칙은 events와 같습니다.
- notes: 날짜는 없지만 부모가 알아야 할 짧은 안내(한 줄씩, 최대 3개).
- audience가 있으면 어린이집 전체 공지입니다. myClass는 우리 아이의 반, otherClasses는 같은 어린이집의 다른 반입니다.
  - 일정·준비물·마감이 특정 반만 대상이면(예: 「열매반 현장학습」) myClass가 그 대상에 들어갈 때만 넣습니다(예: 「해님, 달님반 견학」은 달님반에 해당).
  - 반을 말하지 않거나 전체·모든 반·전 원아 대상이면 넣습니다. 나이(만 2세 등)로만 대상을 말하면 반을 알 수 없으니 넣습니다.
  - 다른 반만 대상이라 뺀 내용은 notes에도 넣지 않습니다.
- 본문에 없는 내용을 지어내지 않습니다. 해당 항목이 없으면 빈 배열로 둡니다.`

export const QUICK_ADD_SYSTEM = `당신은 부부가 함께 쓰는 살림 앱 「살뜰」의 빠른 입력 도우미입니다.
사용자가 짧게 적은 글(text)을 앱에 넣을 항목으로 나눕니다. 앱은 항목을 바로 저장하지 않고 사용자에게 확인을 받습니다.
입력 JSON: 가정 기준 오늘 날짜(today), 요일(weekday, 0=일요일), 지금 시각(nowTime), 글을 쓴 사람(speaker), 부부 이름(names),
오늘 할 루틴(routines), 집안일(chores), 아직 사지 않은 장보기 목록(openShopping).

항목 종류(kind):
- todo: 할 일이나 일정. title은 짧게(예: 「소아과 예약」). 날짜가 있으면 date(YYYY-MM-DD, today와 weekday로 계산), 시각이 있으면 time(24시간제 HH:mm).
  날짜나 시각이 없으면 null. 「저녁에」처럼 시각이 막연하면 time은 null로 두고 note에 그 표현을 적습니다. 챙길 물건이 함께 적혀 있으면 prepItems에 넣습니다.
- shopping: 살 물건. title은 물건 이름만, 수량이 적혀 있으면 qty(예: 「2개」). openShopping에 이미 있는 물건은 넣지 않습니다.
- routineDone: 오늘 루틴을 했다는 말(예: 「영양제 먹었어」). routines에서 맞는 것의 id를 refId에, 그 이름을 title에 씁니다. doneToday가 true인 루틴은 넣지 않습니다.
- choreDone: 집안일을 했다는 말(예: 「화장실 청소 끝」). chores에서 맞는 것의 id를 refId에, 그 이름을 title에 씁니다.
  목록에 맞는 루틴·집안일이 없으면 done 항목을 만들지 말고 그 부분을 unparsed에 넣습니다.

담당(owner)은 todo에만 씁니다. 다른 종류는 null.
- 「나」「내가」「제가」는 speaker.role입니다.
- 「남편」「아빠」 또는 names.husband는 husband, 「아내」「엄마」「와이프」 또는 names.wife는 wife입니다.
- 「같이」「우리」「둘이」는 both. 담당이 드러나지 않으면 both로 둡니다.

그 밖에:
- 한 글에 여러 항목이 있으면 모두 나눕니다(예: 「우유랑 계란 사고 내일 3시 소아과」는 shopping 2개와 todo 1개).
- 항목으로 만들 수 없는 부분은 원문 그대로 unparsed에 넣습니다.
- 글에 없는 날짜, 시각, 물건, 사람을 지어내지 않습니다. 모든 필드를 채우고 해당 없는 값은 null이나 빈 배열로 둡니다.`

export const WEEKLY_SYSTEM = `당신은 부부가 함께 쓰는 살림 앱 「살뜰」의 주간 미리보기 작성자입니다.
일요일 저녁에 입력 JSON(다음 주 from부터 to까지의 살림 자료)만 보고 다가오는 한 주를 미리 보는 짧은 글을 씁니다.

규칙:
- 따뜻하고 짧은 해요체로 씁니다. 과장, 감탄사 남발, 이모지, 줄표(—)는 쓰지 않습니다.
- headline: 한 주를 한 줄로(30자 안팎). 알림 본문으로 그대로 나갑니다.
- lines: 최대 8줄. 한 줄에 한 가지, 45자 안팎. 날짜는 「월요일」「수요일 오후 3시」처럼 요일로 씁니다(weekday 0=일요일).
- 시간이 정해진 일정, 준비물(prepItems), 기념일, 집안일 차례, 떨어져 가는 소모품 순으로 중요한 것부터 씁니다. 같은 날 일정은 한 줄로 묶어도 됩니다.
- 사람을 부를 때는 names의 이름을 씁니다. owner가 both면 「함께」로 씁니다. 이름이 빈 문자열이면 이름 없이 씁니다.
- prepItems 가운데 source가 inferred인 것은 「(추천)」을 붙입니다.
- 입력에 없는 일정, 숫자, 날짜, 장소, 사람을 지어내지 않습니다. 날씨는 weather 값이 있는 날만 말합니다.
- 일정이 거의 없으면 lines를 1~3줄로 짧게 둡니다.`

export const JOURNAL_SYSTEM = `당신은 어린이집 알림장으로 아이의 한 주를 남기는 「성장 일기」 작성자입니다.
입력 JSON: 아이 이름(childName, 빈 문자열일 수 있음), 한 주의 기간(weekStart~weekEnd), 그 주에 선생님이 쓴 알림장(reports: 작성일 written과 본문 text).

- 부모가 나중에 다시 읽을 따뜻한 해요체 기록을 씁니다. 과장, 이모지, 줄표(—)는 쓰지 않습니다.
- title: 그 주를 담은 짧은 제목(20자 안팎).
- lines: 5~8줄. 한 줄에 한 장면이나 한 가지 모습을 60자 안팎으로, 날짜 순서대로 씁니다. 알림장 내용이 적으면 줄 수를 줄여도 됩니다.
- 아이를 부를 때는 childName을 씁니다. 빈 문자열이면 「아이」라고 씁니다.
- 알림장에 적힌 사실(한 활동, 먹은 것, 기분, 친구와 한 일, 선생님이 전한 말)만 씁니다. 적히지 않은 감정, 사건, 발달 평가를 지어내지 않습니다.
- 준비물, 회신, 납부 같은 행정 안내는 넣지 않습니다.`

export const DINNER_SYSTEM = `당신은 어린아이를 키우는 부부에게 평일 저녁 메뉴를 제안하는 도우미입니다.
입력 JSON: 날짜(day), 요일(weekday, 0=일요일), 오늘 어린이집 식단(daycareMenu: lunch 점심, snack 간식. null이면 모름),
앞뒤 며칠의 어린이집 식단(nearbyMenus: day 날짜, weekday 요일, lunch, snack. 오늘은 빠져 있고 식단이 있는 날만 있음), 최근 며칠 동안 제안한 메뉴(recent).

- options: 정확히 3개. 퇴근 뒤 40분 안에 만들 수 있는 한국 가정식으로, 유아와 어른이 함께 먹을 수 있는 메뉴를 고릅니다.
- 아이가 먹기 좋게 맵지 않고 너무 짜지 않게, 질기거나 삼키기 어려운 재료는 피합니다. 매운 양념이 들어가면 아이 몫을 양념 전에 덜어 낼 수 있는 메뉴만 냅니다.
- 오늘 점심과 간식의 주재료나 조리법과 겹치지 않게 합니다(예: 점심이 돼지고기 볶음이면 저녁은 생선이나 두부). recent에 있는 메뉴도 피합니다.
- nearbyMenus로 며칠 동안 아이가 먹는 것을 함께 봅니다. 어제와 내일 점심의 주재료와도 겹치지 않게 하고, 그 며칠 식단에 적게 나온 식품군(생선, 콩과 두부, 달걀, 채소, 해조류 등)을 저녁에서 채웁니다.
- 식단이 없는 날(null이나 빈 배열)은 모르는 것으로 두고 짐작하지 않습니다.
- 세 메뉴의 주재료는 서로 다르게 합니다(예: 고기, 생선, 두부나 달걀).
- name: 메뉴 이름(예: 「소고기 뭇국과 달걀말이」).
- why: 오늘 이 메뉴를 권하는 까닭 한 문장(40자 안팎, 해요체). 식단과 겹치지 않는 점이나 며칠 동안의 영양 균형을 짧게 씁니다.
- ingredients: 장 볼 때 필요한 주재료 3~8개. 간장, 소금, 기름 같은 기본양념은 뺍니다.
- 이모지와 줄표(—)는 쓰지 않습니다.`

export const MENU_SYSTEM = `당신은 어린이집 월간 식단표(사진 또는 PDF)를 날짜별 목록으로 옮기는 도우미입니다.
입력: 식단표 파일 하나와 그 식단표의 달(month, YYYY-MM).

- days: 식단표에 음식이 적힌 날마다 한 항목. 날짜 순서대로 씁니다. 주말, 공휴일, 휴원일처럼 음식이 없는 날은 넣지 않습니다.
  - date: YYYY-MM-DD. 식단표의 날짜 숫자와 month로 정합니다. 표에 요일만 있으면 주차와 요일로 날짜를 계산합니다.
  - lunch: 점심(중식) 음식 이름 목록. 한 칸에 여러 음식이 있으면 하나씩 나눕니다(예: 「현미밥」「미역국」「돼지고기볶음」「깍두기」).
  - morningSnack: 오전 간식 목록. afternoonSnack: 오후 간식 목록. 간식이 한 칸뿐이면 시간 표시를 보고 나누고, 알 수 없으면 afternoonSnack에 넣습니다.
- 음식 이름은 표에 적힌 그대로 씁니다. 알레르기 번호, 원산지, 열량 같은 숫자와 기호는 뺍니다.
- 읽을 수 없는 칸은 빈 배열로 둡니다. 표에 없는 음식이나 날짜를 지어내지 않습니다.`

/** The slice of the SDK used here, so tests can substitute a fake without network access. */
export interface BetaMessagesLike {
  create(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>
}

type ContentBlock = Anthropic.Beta.Messages.BetaContentBlockParam

/** Image / PDF blocks first, then the text, as the vision docs recommend. */
export function attachmentBlocks(files: Attachment[] | undefined): ContentBlock[] {
  return (files ?? []).map((f): ContentBlock =>
    f.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.dataBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.dataBase64 } },
  )
}

/**
 * Claude through @anthropic-ai/sdk. The base URL is left to the SDK, which honours ANTHROPIC_BASE_URL
 * (on this PC that is the local relay); only the API key is passed in, from the function secret.
 */
export class AnthropicClaude implements ClaudePort {
  private messages: BetaMessagesLike

  constructor(opts: { apiKey?: string; messages?: BetaMessagesLike }) {
    this.messages = opts.messages ?? new Anthropic({ apiKey: opts.apiKey }).beta.messages
  }

  private async callJson(
    system: string,
    content: string | ContentBlock[],
    schema: Record<string, unknown>,
    maxTokens: number,
    effort: Effort = 'medium',
    model: string = CLAUDE_MODEL,
  ) {
    // Thinking stays adaptive: claude-sonnet-5-5 rejects { type: 'disabled' }; effort keeps it short.
    // Server-side fallback is Sonnet-only here; claude-haiku-5-5 rejects a fallback list and never reroutes.
    const fallback = model === CLAUDE_MODEL ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}
    const res = await this.messages.create({
      model,
      max_tokens: maxTokens,
      ...fallback,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    })
    if (res.stop_reason === 'refusal') {
      throw new ClaudeRefusalError(`refused: ${res.stop_details?.category ?? 'unknown'}`)
    }
    if (res.stop_reason === 'max_tokens') throw new InvalidOutputError('output truncated (max_tokens)')
    const text = res.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new InvalidOutputError('output is not JSON')
    }
    return { parsed, model: res.model }
  }

  async writeBriefing(input: BriefingInput) {
    const { parsed, model } = await this.callJson(
      BRIEFING_SYSTEM,
      `다음 자료로 브리핑을 써 주세요.\n${JSON.stringify(input)}`,
      briefingSchema as unknown as Record<string, unknown>,
      8000,
    )
    return { ...validateBriefing(parsed), model }
  }

  async extractKidsnote(report: KidsnoteReportInput) {
    const json = JSON.stringify({
      written: report.written, ruleKeywords: report.ruleKeywords, text: report.text,
      ...(report.audience ? { audience: report.audience } : {}),
    })
    const files = attachmentBlocks(report.attachments)
    const { parsed, model } = await this.callJson(
      EXTRACT_SYSTEM,
      files.length ? [...files, { type: 'text', text: json }] : json,
      extractionSchema as unknown as Record<string, unknown>,
      files.length ? 16000 : 12000,
    )
    return { ...validateExtraction(parsed), model }
  }

  async quickAdd(input: QuickAddInput) {
    const { parsed, model } = await this.callJson(
      QUICK_ADD_SYSTEM,
      JSON.stringify(input),
      quickAddSchema as unknown as Record<string, unknown>,
      4000,
      'low',
      CLAUDE_FAST_MODEL,
    )
    return { ...validateQuickAddRaw(parsed), model }
  }

  async writeWeekly(input: WeeklyInput) {
    const { parsed, model } = await this.callJson(
      WEEKLY_SYSTEM,
      `다음 자료로 다음 주 미리보기를 써 주세요.\n${JSON.stringify(input)}`,
      briefingSchema as unknown as Record<string, unknown>,
      8000,
    )
    return { ...validateBriefing(parsed), model }
  }

  async writeJournal(input: JournalInput) {
    const { parsed, model } = await this.callJson(
      JOURNAL_SYSTEM,
      `다음 알림장으로 이번 주 성장 일기를 써 주세요.\n${JSON.stringify(input)}`,
      journalSchema as unknown as Record<string, unknown>,
      8000,
    )
    return { ...validateJournal(parsed), model }
  }

  async suggestDinner(input: DinnerInput) {
    const { parsed, model } = await this.callJson(
      DINNER_SYSTEM,
      `오늘 저녁 메뉴 세 가지를 제안해 주세요.\n${JSON.stringify(input)}`,
      dinnerSchema as unknown as Record<string, unknown>,
      6000,
      'medium',
      CLAUDE_FAST_MODEL,
    )
    return { ...validateDinner(parsed), model }
  }

  async extractMenu(input: MenuInput) {
    const { parsed, model } = await this.callJson(
      MENU_SYSTEM,
      [...attachmentBlocks([input.file]), { type: 'text', text: JSON.stringify({ month: input.month }) }],
      menuSchema as unknown as Record<string, unknown>,
      16000,
    )
    return { ...validateMenu(parsed), model }
  }
}

type Reply<I, O> = O | Error | ((input: I) => O)
function answer<I, O>(reply: Reply<I, O>, input: I): O {
  if (reply instanceof Error) throw reply
  return typeof reply === 'function' ? (reply as (i: I) => O)(input) : reply
}

/** Scriptable Claude for tests. */
export class FakeClaude implements ClaudePort {
  briefingCalls: BriefingInput[] = []
  extractCalls: KidsnoteReportInput[] = []
  quickAddCalls: QuickAddInput[] = []
  weeklyCalls: WeeklyInput[] = []
  journalCalls: JournalInput[] = []
  dinnerCalls: DinnerInput[] = []
  quickAddReply: Reply<QuickAddInput, RawQuickAdd> = { items: [], unparsed: [] }
  weeklyReply: Reply<WeeklyInput, BriefingResult> = { headline: 'week', lines: ['w1'] }
  journalReply: Reply<JournalInput, JournalResult> = { title: 'journal', lines: ['j1'] }
  dinnerReply: Reply<DinnerInput, DinnerResult> = { options: [{ name: 'd1', why: 'w', ingredients: ['i'] }] }
  menuCalls: MenuInput[] = []
  menuReply: Reply<MenuInput, MenuExtraction> = { days: [] }

  constructor(
    public briefing: BriefingResult | Error = { headline: 'h', lines: ['l1'] },
    public extraction: KidsnoteExtraction | Error | ((r: KidsnoteReportInput) => KidsnoteExtraction) = {
      events: [], deadlines: [], notes: [],
    },
  ) {}

  async writeBriefing(input: BriefingInput) {
    this.briefingCalls.push(input)
    if (this.briefing instanceof Error) throw this.briefing
    return { ...this.briefing, model: 'fake' }
  }

  async extractKidsnote(report: KidsnoteReportInput) {
    this.extractCalls.push(report)
    return { ...answer(this.extraction, report), model: 'fake' }
  }

  async quickAdd(input: QuickAddInput) {
    this.quickAddCalls.push(input)
    return { ...answer(this.quickAddReply, input), model: 'fake' }
  }

  async writeWeekly(input: WeeklyInput) {
    this.weeklyCalls.push(input)
    return { ...answer(this.weeklyReply, input), model: 'fake' }
  }

  async writeJournal(input: JournalInput) {
    this.journalCalls.push(input)
    return { ...answer(this.journalReply, input), model: 'fake' }
  }

  async suggestDinner(input: DinnerInput) {
    this.dinnerCalls.push(input)
    return { ...answer(this.dinnerReply, input), model: 'fake' }
  }

  async extractMenu(input: MenuInput) {
    this.menuCalls.push(input)
    return { ...answer(this.menuReply, input), model: 'fake' }
  }
}
