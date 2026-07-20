/* ============================================================================
 * data.js — the illustrative model behind "Your Algorithm"
 *
 * IMPORTANT: This is a *simulation*, not a scrape. No real feeds are read.
 * It is a hand-built model of how demographic signals + each platform's
 * incentives tend to shape what gets amplified. The goal is insight into the
 * *shape* of these worlds, not a claim about any specific real post.
 * ==========================================================================*/

/* ---- Interests the user can select ------------------------------------- */
export const INTERESTS = [
  { key: "politics",      label: "Politics" },
  { key: "news",          label: "Current events" },
  { key: "fitness",       label: "Fitness & health" },
  { key: "beauty",        label: "Beauty & fashion" },
  { key: "gaming",        label: "Gaming" },
  { key: "tech",          label: "Tech & AI" },
  { key: "finance",       label: "Money & investing" },
  { key: "parenting",     label: "Parenting & family" },
  { key: "sports",        label: "Sports" },
  { key: "food",          label: "Food & cooking" },
  { key: "spirituality",  label: "Spirituality & wellness" },
  { key: "entertainment", label: "Celebrity & entertainment" },
  { key: "relationships", label: "Dating & relationships" },
  { key: "outdoors",      label: "Travel & outdoors" },
];

/* ---- Content categories ------------------------------------------------ *
 * interest : which selectable interest this maps to (null = universal)
 * political: whether the post is filtered/amplified by political leaning
 * age      : affinity weights across young / mid / old
 * gender   : affinity weights across woman / man / nb (1 = neutral)
 * -------------------------------------------------------------------------*/
export const CATEGORIES = {
  partisan_left:   { label: "Progressive politics", interest: "politics", political: true,  age: { young: 1.2, mid: 1, old: .9 }, gender: { woman: 1.15, man: .9, nb: 1.3 } },
  partisan_right:  { label: "Conservative politics", interest: "politics", political: true,  age: { young: .8, mid: 1, old: 1.3 }, gender: { woman: .85, man: 1.25, nb: .6 } },
  outrage_news:    { label: "Outrage news",          interest: "news",     political: true,  age: { young: .9, mid: 1.1, old: 1.3 }, gender: { woman: 1, man: 1.05, nb: 1 } },
  breaking_news:   { label: "Breaking news",         interest: "news",     political: false, age: { young: .9, mid: 1.1, old: 1.2 }, gender: { woman: 1, man: 1, nb: 1 } },
  conspiracy:      { label: "Conspiracy / distrust", interest: null,       political: true,  age: { young: 1.1, mid: 1.1, old: 1.1 }, gender: { woman: .9, man: 1.2, nb: .9 } },
  wellness:        { label: "Wellness & astrology",  interest: "spirituality", political: false, age: { young: 1.2, mid: 1.1, old: .8 }, gender: { woman: 1.4, man: .6, nb: 1.2 } },
  fitness:         { label: "Fitness",               interest: "fitness",  political: false, age: { young: 1.3, mid: 1.1, old: .7 }, gender: { woman: 1, man: 1.1, nb: 1 } },
  beauty:          { label: "Beauty & fashion",      interest: "beauty",   political: false, age: { young: 1.4, mid: 1, old: .6 }, gender: { woman: 1.5, man: .5, nb: 1.1 } },
  gaming:          { label: "Gaming",                interest: "gaming",   political: false, age: { young: 1.5, mid: .9, old: .4 }, gender: { woman: .8, man: 1.4, nb: 1.1 } },
  tech:            { label: "Tech & AI",             interest: "tech",     political: false, age: { young: 1.2, mid: 1.1, old: .8 }, gender: { woman: .85, man: 1.3, nb: 1 } },
  hustle:          { label: "Money & hustle",        interest: "finance",  political: false, age: { young: 1.3, mid: 1.1, old: .8 }, gender: { woman: .8, man: 1.4, nb: .9 } },
  crypto:          { label: "Crypto",                interest: "finance",  political: false, age: { young: 1.4, mid: 1, old: .5 }, gender: { woman: .6, man: 1.5, nb: .9 } },
  parenting:       { label: "Parenting",             interest: "parenting", political: false, age: { young: .7, mid: 1.4, old: 1 }, gender: { woman: 1.4, man: .7, nb: 1 } },
  relationships:   { label: "Dating & relationships", interest: "relationships", political: false, age: { young: 1.4, mid: 1, old: .7 }, gender: { woman: 1.2, man: 1, nb: 1.2 } },
  manosphere:      { label: "Manosphere",            interest: "relationships", political: true, age: { young: 1.4, mid: 1, old: .6 }, gender: { woman: .3, man: 1.8, nb: .4 } },
  tradwife:        { label: "Tradwife / homemaking", interest: "parenting", political: true, age: { young: 1.1, mid: 1.1, old: .8 }, gender: { woman: 1.5, man: .5, nb: .5 } },
  sports:          { label: "Sports",               interest: "sports",   political: false, age: { young: 1.1, mid: 1.1, old: 1 }, gender: { woman: .8, man: 1.4, nb: .9 } },
  food:            { label: "Food & cooking",        interest: "food",     political: false, age: { young: 1.1, mid: 1.1, old: 1 }, gender: { woman: 1.2, man: .9, nb: 1 } },
  entertainment:   { label: "Celebrity & memes",     interest: "entertainment", political: false, age: { young: 1.3, mid: 1, old: .8 }, gender: { woman: 1.1, man: 1, nb: 1.1 } },
  truecrime:       { label: "True crime",            interest: "entertainment", political: false, age: { young: 1.1, mid: 1.2, old: 1 }, gender: { woman: 1.4, man: .7, nb: 1.1 } },
  travel:          { label: "Travel & outdoors",     interest: "outdoors", political: false, age: { young: 1.1, mid: 1.1, old: 1 }, gender: { woman: 1.1, man: 1, nb: 1 } },
  wholesome:       { label: "Animals & wholesome",   interest: null,       political: false, age: { young: 1, mid: 1, old: 1.2 }, gender: { woman: 1.2, man: .9, nb: 1 } },
  healthmisinfo:   { label: "Health claims",         interest: "spirituality", political: false, age: { young: 1, mid: 1.1, old: 1.3 }, gender: { woman: 1.2, man: .9, nb: 1 } },
  localcivic:      { label: "Local & community",     interest: "news",     political: false, age: { young: .8, mid: 1.1, old: 1.4 }, gender: { woman: 1.1, man: 1, nb: 1 } },
};

/* ---- The post bank ----------------------------------------------------- *
 * lean : political skew, -2 (left) .. +2 (right), 0 = apolitical
 * bait : engagement-bait intensity 0..1 (controversy, cliffhanger, dunk)
 * tone : outrage | fear | aspiration | wholesome | informative | identity | comedy
 * -------------------------------------------------------------------------*/
export const POSTS = [
  // progressive politics
  { cat: "partisan_left", handle: "@justicenow", tone: "outrage", lean: -2, bait: .8, text: "They just voted to gut the program that keeps kids fed. Remember this in November." },
  { cat: "partisan_left", handle: "@policywonk", tone: "informative", lean: -1, bait: .3, text: "New study: the tax cut paid for itself in exactly zero of the years they promised. Thread 🧵" },
  { cat: "partisan_left", handle: "@mutualaidatx", tone: "identity", lean: -2, bait: .4, text: "This is what community looks like when the state won't show up." },
  // conservative politics
  { cat: "partisan_right", handle: "@realpatriot", tone: "outrage", lean: 2, bait: .85, text: "They want to control what you drive, what you eat, and now what you say. Wake up." },
  { cat: "partisan_right", handle: "@commonsense_us", tone: "identity", lean: 1, bait: .3, text: "Small towns built this country. The people mocking them have never fixed a fence." },
  { cat: "partisan_right", handle: "@freemarketdad", tone: "informative", lean: 1, bait: .35, text: "Gas was $2.10 four years ago. Ask yourself what changed." },
  // outrage / culture war (both sides)
  { cat: "outrage_news", handle: "@thedailyrage", tone: "outrage", lean: 1.5, bait: .9, text: "You won't BELIEVE what this school district just put in the curriculum. Parents are furious." },
  { cat: "outrage_news", handle: "@clapback", tone: "outrage", lean: -1.5, bait: .9, text: "A billionaire just told you to work harder. From his third yacht. Let that sink in." },
  { cat: "outrage_news", handle: "@ragefarm", tone: "outrage", lean: 0, bait: .95, text: "Everyone is talking about this clip and no one has the full context. Watch before it's deleted." },
  // breaking news
  { cat: "breaking_news", handle: "@wirefeed", tone: "informative", lean: 0, bait: .3, text: "BREAKING: Central bank holds rates steady, signals one cut before year-end." },
  { cat: "breaking_news", handle: "@globaldesk", tone: "informative", lean: 0, bait: .25, text: "Live: evacuation orders expand as the wildfire jumps the ridge line overnight." },
  // conspiracy / distrust
  { cat: "conspiracy", handle: "@questioneverything", tone: "fear", lean: 1, bait: .8, text: "They told you it was safe. They told you a lot of things. Do your own research." },
  { cat: "conspiracy", handle: "@wakeuptruth", tone: "fear", lean: .5, bait: .85, text: "Why did they quietly change the definition last week? Screenshots before it's gone." },
  // wellness / astrology
  { cat: "wellness", handle: "@moonchild", tone: "identity", lean: 0, bait: .3, text: "Mercury retrograde starts today. If everything feels off, that's why. Rest, don't sign contracts." },
  { cat: "wellness", handle: "@nervous.system.reset", tone: "aspiration", lean: 0, bait: .4, text: "Your anxiety might be a dysregulated nervous system, not a personality flaw. Here's the 3-min reset." },
  // fitness
  { cat: "fitness", handle: "@coachdlifts", tone: "aspiration", lean: 0, bait: .4, text: "You don't need motivation. You need a plan you can't talk yourself out of. Day 1 below." },
  { cat: "fitness", handle: "@runnerhigh", tone: "wholesome", lean: 0, bait: .2, text: "Ran my first 5k this morning. Six months ago I couldn't do the block. Start slow, stay stubborn." },
  // beauty / fashion
  { cat: "beauty", handle: "@glowbymara", tone: "aspiration", lean: 0, bait: .5, text: "The $12 serum that made three dermatologists ask what I've been using. Not sponsored (yet)." },
  { cat: "beauty", handle: "@fitcheckdaily", tone: "aspiration", lean: 0, bait: .35, text: "Fall capsule wardrobe: 9 pieces, 40 outfits. Save this before it's gone." },
  // gaming
  { cat: "gaming", handle: "@nocluenoah", tone: "comedy", lean: 0, bait: .4, text: "Went for the impossible skip. Got the impossible skip. Chat lost their minds. Clip inside." },
  { cat: "gaming", handle: "@patchnotes", tone: "informative", lean: 0, bait: .3, text: "The new update quietly nerfed the thing everyone was building around. Full breakdown." },
  // tech / AI
  { cat: "tech", handle: "@buildinpublic", tone: "aspiration", lean: 0, bait: .4, text: "Shipped a whole app this weekend with an AI pair. Here's what it still can't do." },
  { cat: "tech", handle: "@ai.doomer", tone: "fear", lean: 0, bait: .7, text: "The model can now do the thing they said it couldn't do last year. Your move." },
  // money / hustle
  { cat: "hustle", handle: "@sixfigureside", tone: "aspiration", lean: 0, bait: .75, text: "I made more last month from one spreadsheet than my old salary. Comment 'MONEY' and I'll send it." },
  { cat: "hustle", handle: "@quietwealth", tone: "informative", lean: 0, bait: .3, text: "Boring truth: index fund, automate it, ignore it for 20 years. That's the whole 'secret'." },
  // crypto
  { cat: "crypto", handle: "@degenchad", tone: "aspiration", lean: 0, bait: .85, text: "Everyone laughed at this coin last cycle. Not laughing now. Still early. NFA." },
  // parenting
  { cat: "parenting", handle: "@twoundertwo", tone: "wholesome", lean: 0, bait: .3, text: "No one tells you the loneliest part of new parenthood is 3am. You're not failing. It's just hard." },
  { cat: "parenting", handle: "@gentleparent", tone: "identity", lean: -.5, bait: .4, text: "Stop saying 'you're okay' when they're clearly not. Name the feeling instead. Here's how." },
  // relationships / dating
  { cat: "relationships", handle: "@textbackenergy", tone: "identity", lean: 0, bait: .55, text: "If they wanted to, they would. Stop translating the bare minimum into a love language." },
  // manosphere
  { cat: "manosphere", handle: "@alphamindset", tone: "identity", lean: 1.5, bait: .8, text: "Society told you to be nice and it left you invisible. Get strong, get quiet, get money." },
  { cat: "manosphere", handle: "@sigmagrind", tone: "outrage", lean: 1.2, bait: .75, text: "They'll shame you for lifting and simp for the guy who ignores them. Read that twice." },
  // tradwife
  { cat: "tradwife", handle: "@homesteadhannah", tone: "aspiration", lean: 1.3, bait: .5, text: "Left the corporate grind to bake bread and raise my kids. Best decision I ever made." },
  // sports
  { cat: "sports", handle: "@courtside", tone: "outrage", lean: 0, bait: .6, text: "That was NOT a foul and the refs owe this city an apology. Replay it frame by frame." },
  { cat: "sports", handle: "@statsheet", tone: "informative", lean: 0, bait: .3, text: "He's quietly having the best season of the decade and nobody's talking about it." },
  // food
  { cat: "food", handle: "@onepotwonders", tone: "wholesome", lean: 0, bait: .3, text: "Dinner in one pan, 20 minutes, five ingredients you already have. Save it." },
  { cat: "food", handle: "@spicygremlin", tone: "comedy", lean: 0, bait: .4, text: "I added a secret ingredient your grandmother would fight me over. It works. Don't @ me." },
  // entertainment / memes
  { cat: "entertainment", handle: "@popcultured", tone: "comedy", lean: 0, bait: .5, text: "The internet has decided. There is one correct opinion about last night's finale and this is it." },
  { cat: "entertainment", handle: "@celebradar", tone: "outrage", lean: 0, bait: .7, text: "They said WHAT at the after-party? The group chat is not okay." },
  // true crime
  { cat: "truecrime", handle: "@casefiles", tone: "fear", lean: 0, bait: .6, text: "Everyone in town knew. Nobody said a word for 12 years. Part 3 tonight." },
  // travel
  { cat: "travel", handle: "@vanlifevera", tone: "aspiration", lean: 0, bait: .4, text: "Quit the job, sold the couch, woke up to this view. You have more options than you think." },
  // wholesome / animals
  { cat: "wholesome", handle: "@dailygoodboy", tone: "wholesome", lean: 0, bait: .2, text: "Shelter dog waited 400 days. Watch the moment he realizes he's finally going home. 🥹" },
  // health claims / misinfo-adjacent
  { cat: "healthmisinfo", handle: "@rootcausemd", tone: "fear", lean: .5, bait: .7, text: "Your doctor won't tell you this because they can't bill for it. The pantry fix that changed everything." },
  // local / civic
  { cat: "localcivic", handle: "@ourtownnews", tone: "informative", lean: 0, bait: .25, text: "City council votes Thursday on the new bus route. Here's who it helps and who's against it." },
  { cat: "localcivic", handle: "@neighborhoodwatch", tone: "fear", lean: .5, bait: .55, text: "Third car break-in on Maple this week. Ring footage in the comments. Lock your doors." },
];

/* ---- Platform "algorithm personalities" -------------------------------- *
 * catBias    : how hard the platform pushes each category (default 1)
 * bait       : how much engagement-bait is amplified (1 = neutral)
 * amplify    : how strongly it reinforces the user's political leaning
 * rageOther  : how much it also injects *opposing* outrage (anger = watch time)
 * discovery  : how much it shows content outside your stated interests (0..1)
 * ageFocus   : how strongly demographics steer the feed (personalization strength)
 * -------------------------------------------------------------------------*/
export const PLATFORMS = [
  {
    key: "tiktok", name: "TikTok", emoji: "🎵", color: "#25f4ee",
    tagline: "Interest-graph discovery. It barely cares who you follow — it watches what stops your thumb.",
    bait: 1.6, amplify: 1.2, rageOther: .5, discovery: .75, ageFocus: 1.3,
    catBias: { beauty: 1.6, wellness: 1.5, entertainment: 1.5, fitness: 1.4, conspiracy: 1.4, manosphere: 1.4, comedy: 1.4, hustle: 1.3, truecrime: 1.3, food: 1.2, breaking_news: .5, localcivic: .4 },
  },
  {
    key: "instagram", name: "Instagram", emoji: "📸", color: "#e1306c",
    tagline: "Aspiration engine. Polished lives, before/afters, and whatever you'll compare yourself to.",
    bait: 1.2, amplify: .8, rageOther: .2, discovery: .5, ageFocus: 1.2,
    catBias: { beauty: 1.8, fitness: 1.6, travel: 1.6, tradwife: 1.4, food: 1.3, wellness: 1.3, hustle: 1.2, parenting: 1.2, outrage_news: .5, conspiracy: .4, breaking_news: .4 },
  },
  {
    key: "youtube", name: "YouTube", emoji: "▶️", color: "#ff0000",
    tagline: "The rabbit hole. Optimizes for the next click, and the next — deeper into a lane each time.",
    bait: 1.3, amplify: 1.5, rageOther: .4, discovery: .35, ageFocus: 1.1,
    catBias: { gaming: 1.7, tech: 1.6, conspiracy: 1.5, manosphere: 1.5, hustle: 1.4, truecrime: 1.4, partisan_right: 1.3, partisan_left: 1.3, sports: 1.2, beauty: 1.1 },
  },
  {
    key: "x", name: "X", emoji: "𝕏", color: "#71767b",
    tagline: "The argument. Real-time, political, and tuned so the angriest quote-tweet travels furthest.",
    bait: 1.7, amplify: 1.7, rageOther: 1.4, discovery: .3, ageFocus: .8,
    catBias: { outrage_news: 1.8, partisan_left: 1.6, partisan_right: 1.6, breaking_news: 1.5, tech: 1.4, sports: 1.3, conspiracy: 1.3, manosphere: 1.2, beauty: .5, wellness: .5, parenting: .5 },
  },
  {
    key: "facebook", name: "Facebook", emoji: "👥", color: "#1877f2",
    tagline: "The family reunion. Older, local, and where a shared article becomes the whole town's truth.",
    bait: 1.3, amplify: 1.3, rageOther: .7, discovery: .25, ageFocus: 1.4,
    catBias: { localcivic: 1.7, outrage_news: 1.5, healthmisinfo: 1.5, conspiracy: 1.4, partisan_right: 1.3, wholesome: 1.3, parenting: 1.3, tradwife: 1.2, gaming: .5, beauty: .7 },
  },
  {
    key: "reddit", name: "Reddit", emoji: "🤖", color: "#ff4500",
    tagline: "Interest tribes. Less about who you are, more about which room you wandered into.",
    bait: 1.1, amplify: 1.0, rageOther: .8, discovery: .4, ageFocus: .6,
    catBias: { gaming: 1.7, tech: 1.6, hustle: 1.2, crypto: 1.3, sports: 1.3, truecrime: 1.3, relationships: 1.3, conspiracy: 1.2, beauty: .8, tradwife: .5 },
  },
];

/* leaning slider positions -> numeric lean */
export const LEANINGS = [
  { label: "Far left", value: -2 },
  { label: "Left", value: -1 },
  { label: "Center", value: 0 },
  { label: "Right", value: 1 },
  { label: "Far right", value: 2 },
];

export const AGES = [
  { key: "teen",  label: "13–17", bucket: "young", n: 15 },
  { key: "young", label: "18–24", bucket: "young", n: 21 },
  { key: "adult", label: "25–34", bucket: "mid",   n: 29 },
  { key: "mid",   label: "35–49", bucket: "mid",   n: 42 },
  { key: "older", label: "50–64", bucket: "old",   n: 57 },
  { key: "senior",label: "65+",   bucket: "old",   n: 70 },
];

export const GENDERS = [
  { key: "woman", label: "Woman" },
  { key: "man",   label: "Man" },
  { key: "nb",    label: "Nonbinary" },
];
