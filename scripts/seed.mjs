// Seeds the local emulators with two example users and example household data (all values are examples).
// Run while `npm run emulators` is up: node scripts/seed.mjs
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099'

const { initializeApp } = await import('firebase-admin/app')
const { getAuth } = await import('firebase-admin/auth')
const { getFirestore } = await import('firebase-admin/firestore')

initializeApp({ projectId: 'demo-saltteul' })
const auth = getAuth()
const db = getFirestore()
const PASSWORD = 'saltteul-dev'

async function user(uid, email, displayName) {
  try { await auth.deleteUser(uid) } catch { /* not there yet */ }
  await auth.createUser({ uid, email, displayName, password: PASSWORD, emailVerified: true })
}
await user('husband-uid', 'husband@example.com', '민우')
await user('wife-uid', 'wife@example.com', '지은')

const KST = 9 * 3600 * 1000
const hd = (offsetDays = 0) => new Date(Date.now() + KST - 4 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10)
const today = hd(0)
const now = Date.now()
const H = db.doc('households/home')

await db.recursiveDelete(H)
await H.set({ memberUids: ['husband-uid', 'wife-uid'], allowedEmails: ['husband@example.com', 'wife@example.com'], createdAt: now })
await db.doc('users/husband-uid').set({ hid: 'home' })
await db.doc('users/wife-uid').set({ hid: 'home' })
await H.collection('members').doc('husband-uid').set({ uid: 'husband-uid', email: 'husband@example.com', displayName: '민우', role: 'husband' })
await H.collection('members').doc('wife-uid').set({ uid: 'wife-uid', email: 'wife@example.com', displayName: '지은', role: 'wife' })
await H.collection('settings').doc('main').set({
  familyName: '민우네',
  briefingTimes: { morning: '07:30', evening: '20:00' },
  calendarId: null,
  location: { label: '서울 중구', lat: 37.5665, lon: 126.978 },
  weather: { updatedAt: now, days: [
    { day: today, minC: 9, maxC: 18, popMax: 70, sky: 'rain', rainFrom: '16:00' },
    { day: hd(1), minC: 7, maxC: 15, popMax: 10, sky: 'clear', rainFrom: null },
  ] },
})

const add = (c, d) => H.collection(c).add(d)
await Promise.all([
  add('todos', { title: '관리비 자동이체 확인', date: today, time: '08:30', owner: 'husband', done: true, doneBy: 'husband-uid', doneAt: now, source: 'manual', updatedAt: now }),
  add('todos', { title: '자동차 정기검사 예약', date: today, time: '15:00', owner: 'both', done: false, source: 'calendar', calendarEventId: 'ex1', updatedAt: now }),
  add('todos', { title: '치과 정기검진', date: today, time: '18:30', owner: 'wife', done: false, source: 'manual', updatedAt: now }),
  add('todos', { title: '[키즈노트] 체육활동', date: hd(1), owner: 'both', done: false, source: 'kidsnote', kidsnoteBatchId: 'batch-ex', updatedAt: now,
    prepItems: [{ name: '체육복', source: 'rule' }, { name: '운동화', source: 'rule' }, { name: '물통', source: 'inferred' }] }),
  add('todos', { title: '[키즈노트] 가을 소풍', date: hd(5), owner: 'both', done: false, source: 'kidsnote', kidsnoteBatchId: 'batch-ex', updatedAt: now,
    prepItems: [{ name: '도시락', source: 'stated' }, { name: '돗자리', source: 'inferred' }] }),
  add('todos', { title: '전구 사기', owner: 'husband', done: false, source: 'manual', updatedAt: now }),
  add('shopping', { name: '국산 두부', qty: '1모', note: '된장찌개용', addedBy: 'wife-uid', bought: false, source: 'manual', createdAt: now - 3000 }),
  add('shopping', { name: '우유 1L', qty: '2개', addedBy: 'husband-uid', bought: false, source: 'manual', createdAt: now - 2000 }),
  add('shopping', { name: '애호박', addedBy: 'wife-uid', bought: false, source: 'manual', createdAt: now - 1000 }),
  add('shopping', { name: '주방세제 리필', addedBy: 'wife-uid', bought: true, boughtBy: 'wife-uid', boughtAt: now - 600000, source: 'manual', createdAt: now - 9000 }),
  add('routines', { title: '설거지', owner: 'both', order: 0, active: true }),
  add('routines', { title: '아이 가방 확인', owner: 'wife', order: 1, active: true }),
  add('routines', { title: '식물 물 주기', owner: 'husband', order: 2, active: true }),
  add('routines', { title: '분리수거 내놓기', owner: 'husband', weekdays: [2, 4, 0], order: 3, active: true }),
  add('chores', { title: '화장실 청소', owner: 'both', cycleDays: 7, lastDone: hd(-9), createdDay: hd(-30), history: [] }),
  add('chores', { title: '침구 세탁', owner: 'wife', cycleDays: 14, lastDone: hd(-14), createdDay: hd(-30), history: [] }),
  add('chores', { title: '냉장고 정리', owner: 'husband', cycleDays: 14, lastDone: hd(-4), createdDay: hd(-30), history: [] }),
  add('chores', { title: '에어컨 필터 청소', owner: 'husband', cycleDays: 30, lastDone: hd(-12), createdDay: hd(-30), history: [] }),
  add('anniversaries', { kind: 'together', title: '처음 만난 날', date: '2016-03-12' }),
  add('anniversaries', { kind: 'wedding', title: '결혼기념일', date: `2019-${hd(12).slice(5)}`, remindDays: [7, 1] }),
  add('anniversaries', { kind: 'birthday', title: '아이 생일', person: '아이', date: `2022-${hd(40).slice(5)}`, remindDays: [7, 1] }),
  add('consumables', { name: '식기세척기 세제', initialCycleDays: 30, purchases: [hd(-58), hd(-29)] }),
  add('consumables', { name: '정수기 필터', initialCycleDays: 90, purchases: [hd(-80)] }),
  add('prepRules', { keyword: '체육', items: ['체육복', '운동화'] }),
  add('prepRules', { keyword: '수영', items: ['수영복', '수모', '수건'] }),
  add('briefings', { day: today, slot: 'morning', createdAt: now, model: 'claude-opus-5-5',
    headline: '오후에 비 소식이 있어요. 빨래는 오전에 걷어 주세요.',
    lines: ['오후 3시 자동차 정기검사 예약을 잊지 마세요.', '화장실 청소가 이틀 밀렸어요.', '식기세척기 세제가 곧 떨어질 것 같아 장보기에 추천으로 띄웠어요.', '내일 체육활동이 있어요. 체육복과 운동화를 챙겨 주세요.'] }),
  add('nudges', { from: 'wife-uid', to: 'husband-uid', targetType: 'shopping', targetTitle: '국산 두부', message: '퇴근길에 부탁해', read: false, createdAt: now - 60000 }),
])
await H.collection('routineLogs').doc('seed').delete().catch(() => {})

// Example data for the weekly preview, growth journal and dinner cards.
const wd = new Date(`${today}T00:00:00Z`).getUTCDay()
const thisMonday = -(wd === 0 ? 6 : wd - 1)
await H.collection('briefings').add({ day: hd(thisMonday - 1), slot: 'weekly', createdAt: now - 3 * 86400000, model: 'claude-opus-5-5',
  headline: '이번 주는 소풍과 결혼기념일 준비가 있어요.',
  lines: ['금요일 가을 소풍 도시락을 미리 정해 두세요.', '다음 주 결혼기념일 저녁 예약을 이번 주 안에 해 두면 좋아요.'] })
const journal = [
  { weekStart: hd(thisMonday - 7), weekEnd: hd(thisMonday - 1), title: '친구와 블록 탑을 쌓은 한 주', reportCount: 4,
    lines: ['친구들과 블록으로 높은 탑을 쌓고 무너지자 다시 쌓아 보았어요.', '점심에 나온 시금치나물을 처음으로 다 먹었어요.', '가을 나뭇잎을 주워 와서 색깔 이름을 하나씩 말했어요.'] },
  { weekStart: hd(thisMonday - 14), weekEnd: hd(thisMonday - 8), title: '노래와 율동을 즐긴 한 주', reportCount: 3,
    lines: ['새로 배운 율동을 집에서도 보여 주고 싶어 했어요.', '낮잠 시간에 스스로 이불을 폈어요.'] },
]
await Promise.all(journal.map((j) => H.collection('journal').doc(j.weekStart).set({
  ...j, childName: '하린', createdAt: now - 86400000, model: 'claude-opus-5-5',
})))
await H.collection('dinner').doc(today).set({
  day: today, createdAt: now, model: 'claude-opus-5-5',
  daycareMenu: { lunch: ['현미밥', '소고기무국', '두부조림', '배추김치'], snack: ['고구마', '우유'] },
  options: [
    { name: '닭고기 채소 카레', why: '점심에 소고기를 먹어서 닭고기로 바꿨어요. 채소를 잘게 썰면 아이도 잘 먹어요.', ingredients: ['닭가슴살', '감자', '당근', '양파', '카레가루'] },
    { name: '연어 구이와 시금치 무침', why: '이번 주에 생선을 아직 안 먹었어요.', ingredients: ['연어', '시금치', '참기름'] },
    { name: '달걀 애호박 볶음밥', why: '15분이면 되는 간단한 메뉴예요.', ingredients: ['달걀', '애호박', '우유 1L'] },
  ],
})
console.log('seeded household "home" for', today, '- login: husband@example.com / wife@example.com, password', PASSWORD)
