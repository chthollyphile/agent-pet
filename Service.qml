import QtQuick
import Quickshell
import Quickshell.Io
import "lib/jsonc.mjs" as Jsonc
import "lib/work-status.mjs" as WS
import "lib/usage.mjs" as Usage

// lia.pet 的状态中枢：配置、Claude Code / Codex 工作状态聚合、用量、LLM、通知、IPC。
// 每块有宠物的屏幕各一个 PetOverlay（全屏透明 layer-shell 窗口）。
Scope {
  id: root

  // 宿主注入
  property var shell: null
  property string omarchyPath: ""
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginDir: decodeURIComponent(String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, ""))
  readonly property string userConfigPath: home + "/.config/omar-pet/config.jsonc"
  readonly property string stateDir: home + "/.local/state/omar-pet"
  readonly property string usageDir: home + "/.local/state/omarchy/agents/usage"

  // ------------------------------------------------------------ 配置
  property var config: ({})
  property bool ready: false
  property string configError: ""
  property int assetFps: 15
  property bool hidden: false

  readonly property var pets: (config.pets || []).filter(function(p) { return p.display !== "none" })

  function rebuildConfig() {
    var base
    try {
      base = JSON.parse(defaultFile.text())
    } catch (e) {
      console.warn("[lia.pet] 内置配置解析失败:", e)
      return
    }
    var merged = Object.assign({}, base)
    configError = ""
    var userText = userFile.loaded ? userFile.text() : ""
    if (userText.trim() !== "") {
      try {
        // 顶层整段替换（与 dsh-pet 同口径）：写了哪个字段就整段用用户的
        Object.assign(merged, Jsonc.parseJsonc(userText))
      } catch (e) {
        configError = String(e)
        console.warn("[lia.pet] 用户配置解析失败，使用内置配置:", e)
      }
    }
    try {
      assetFps = Number(JSON.parse(assetManifest.text()).fps) || 15
    } catch (e) {}
    config = merged
    ready = true
    whisperTimer.restart()
    usageTimer.restart()
    if (configError) speak("", "配置文件写错啦：" + configError, "", "error")
  }

  function reloadConfig() {
    userFile.reload()
    defaultFile.reload()
  }

  FileView {
    id: defaultFile
    path: root.pluginDir + "/assets/config.json"
    blockLoading: true
    onLoaded: root.rebuildConfig()
  }

  FileView {
    id: assetManifest
    path: root.pluginDir + "/assets/webp/manifest.json"
    blockLoading: true
    printErrors: false
  }

  FileView {
    id: userFile
    path: root.userConfigPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: if (defaultFile.loaded) root.rebuildConfig()
    onLoadFailed: if (defaultFile.loaded) root.rebuildConfig()
  }

  // ------------------------------------------------------------ 宠物对外信号
  // petId 为空 = 所有宠物
  signal speak(string petId, string text, string meme, string kind)
  signal playRequest(string petId, string name)
  signal usageShow(var summary)

  // ------------------------------------------------------------ 工作状态
  property var wsStore: WS.createStore()
  // 当前展示的会话快照（对象引用变化 = 宠物要切档位）；null = 没有活跃会话
  property var workStatus: null
  property string lastAgent: "claude"

  function agentEnabled(agent) {
    var a = config.agents || {}
    return a[agent] !== false
  }

  function handleEvent(json) {
    var ev
    try {
      ev = JSON.parse(json)
    } catch (e) {
      return "bad-json"
    }
    if (!ev || !ev.event) return "bad-event"
    if (!agentEnabled(ev.agent)) return "ignored"
    if (ev.agent === "claude" || ev.agent === "codex") lastAgent = ev.agent
    var res = WS.applyEvent(wsStore, ev, Date.now())
    if (res.entered) notifyFor(res.entry)
    if (res.changed) refreshWorkStatus()
    return "ok"
  }

  function refreshWorkStatus() {
    var cur = WS.current(wsStore)
    var prev = workStatus
    if (!cur) {
      if (prev) workStatus = null
      return
    }
    if (prev && prev.key === cur.key && prev.state === cur.state) return
    workStatus = Object.assign({}, cur)
  }

  Timer {
    interval: 5000
    running: true
    repeat: true
    onTriggered: if (WS.prune(root.wsStore, Date.now())) root.refreshWorkStatus()
  }

  // ------------------------------------------------------------ 系统通知
  readonly property var notifyTitles: ({
    waiting: "需要你确认",
    success: "任务完成",
    error: "出错了"
  })
  readonly property var notifyIcons: ({ waiting: "approval", success: "done", error: "error" })

  function notifyFor(entry) {
    if (config.notificationsEnabled === false) return
    var title = notifyTitles[entry.state]
    if (!title) return
    var onlyUnfocused = !config.notify || config.notify.onlyWhenUnfocused !== false
    if (onlyUnfocused && entry.focused) return
    var agentName = entry.agent === "codex" ? "Codex" : "Claude Code"
    var project = WS.projectName(entry.cwd)
    var body = entry.message || (entry.tool ? entry.tool : "")
    Quickshell.execDetached([
      "notify-send", "-a", "omar-pet",
      "-i", root.pluginDir + "/assets/pic/notify-" + notifyIcons[entry.state] + ".png",
      agentName + (project ? " · " + project : "") + " · " + title,
      body
    ])
  }

  // ------------------------------------------------------------ 用量
  property var usageSummaries: ({})
  property var usageTiers: ({})

  function usageAgent() {
    var u = config.usage || {}
    return u.agent && u.agent !== "auto" ? u.agent : lastAgent
  }

  function updateUsage(agent, text) {
    var summary = null
    try {
      summary = Usage.summarize(JSON.parse(text), Date.now())
    } catch (e) {}
    var next = Object.assign({}, usageSummaries)
    next[agent] = summary
    usageSummaries = next
    var prevTier = usageTiers[agent]
    var tiers = Object.assign({}, usageTiers)
    tiers[agent] = summary ? summary.tier : -1
    usageTiers = tiers
    // 首次读取不播；之后档位变化时播一次
    if (summary && prevTier !== undefined && prevTier !== summary.tier && agent === usageAgent()) usageShow(summary)
  }

  function showUsage(manual) {
    var summary = usageSummaries[usageAgent()]
    if (!summary) {
      var other = usageAgent() === "claude" ? "codex" : "claude"
      summary = usageSummaries[other]
    }
    if (summary) usageShow(summary)
    else if (manual) speak("", "还没有用量记录：omarchy.agents 还没生成 Claude / Codex 的数据哦", "", "info")
  }

  FileView {
    path: root.usageDir + "/claude.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.updateUsage("claude", text())
  }

  FileView {
    path: root.usageDir + "/codex.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.updateUsage("codex", text())
  }

  Timer {
    id: usageTimer
    interval: Math.max(60, Number((root.config.eventsRefreshSec || {}).balance) || 1800) * 1000
    running: root.ready
    repeat: true
    onTriggered: root.showUsage(false)
  }

  // ------------------------------------------------------------ 碎碎念 / 对话（只在显式触发或 whisperAuto 开启时调用 LLM）
  Llm {
    id: llm
    home: root.home
    stateDir: root.stateDir
    onFinished: function(petId, kind, text, meme, failed) {
      if (failed) {
        root.speak(petId, text, "", "error")
        return
      }
      if (kind === "chat") root.rememberChat(petId, llm.lastUserText, text)
      root.speak(petId, text, meme, kind)
    }
  }

  readonly property bool llmBusy: llm.busy

  function petById(petId) {
    for (var i = 0; i < pets.length; i++) if (pets[i].id === petId) return pets[i]
    return pets.length ? pets[0] : null
  }

  function memeNames() {
    return Object.keys(config.memes || {})
  }

  function persona(pet) {
    return (config.whisperPrompt || "") + "你的名字是" + (pet.name || pet.id) + "。"
  }

  function llmModel() {
    var l = config.llm || {}
    return (l.provider === "codex" ? l.codexModel : l.claudeModel) || ""
  }

  function requestWhisper(petId) {
    var pet = petById(petId)
    if (!pet) return "no-pet"
    if (llm.busy) return "busy"
    var meme = ""
    var names = memeNames()
    if (config.whisperImageEnabled !== false && names.length) meme = names[Math.floor(Math.random() * names.length)]
    var now = new Date()
    var prompt = "现在是 " + Qt.formatTime(now, "HH:mm") + "。随口碎碎念一句。"
    if (meme) prompt += "这次配的表情包画面是：" + config.memes[meme] + "。让这句话和画面呼应。"
    prompt += "只输出这一句话本身，不要引号。"
    llm.run((config.llm || {}).provider, llmModel(), persona(pet), prompt, pet.id, "whisper", meme)
    return "ok"
  }

  function requestChat(petId, text) {
    var pet = petById(petId)
    if (!pet || !text) return "no-pet"
    if (llm.busy) return "busy"
    var system = persona(pet) + "现在主人在和你聊天，回答要简短自然（60 字以内）。"
    var useMemes = config.chatImageEnabled !== false && memeNames().length > 0
    if (useMemes) {
      var limit = Number(config.chatImageLimit)
      var names = memeNames()
      if (limit > 0) names = names.slice(0, limit)
      system += "只输出一个 JSON 对象：{\"text\": \"回复\", \"meme\": \"表情包名或空字符串\"}。"
        + "表情包可选（名称：描述）：" + names.map(function(n) { return n + "：" + config.memes[n] }).join("；") + "。"
        + "不合适就留空。"
    } else {
      system += "只输出回复内容本身。"
    }
    var rounds = Number(config.chatMemoryRounds)
    if (!(rounds >= 0)) rounds = 5
    var history = chatHistory(pet.id).slice(-rounds)
    var prompt = history.map(function(h) { return "主人：" + h.q + "\n你：" + h.a }).join("\n")
    prompt += (prompt ? "\n" : "") + "主人：" + text
    llm.lastUserText = text
    llm.run((config.llm || {}).provider, llmModel(), system, prompt, pet.id, "chat", "")
    return "ok"
  }

  Timer {
    id: whisperTimer
    interval: Math.max(60, Number((root.config.eventsRefreshSec || {}).whisper) || 300) * 1000
    running: root.ready && root.config.whisperAuto === true
    repeat: true
    onTriggered: {
      // 有 agent 正在干活时不打扰，也不和它抢额度
      if (WS.anyBusy(root.wsStore)) return
      for (var i = 0; i < root.pets.length; i++) {
        if (root.pets[i].whisperEnabled !== false) {
          root.requestWhisper(root.pets[i].id)
          return
        }
      }
    }
  }

  // 对话记忆：{ petId: [{ q, a, t }] }，全量保存，每次请求只截最近 chatMemoryRounds 轮
  property var memory: ({})

  function chatHistory(petId) {
    return memory[petId] || []
  }

  function rememberChat(petId, q, a) {
    var next = Object.assign({}, memory)
    next[petId] = chatHistory(petId).concat([{ q: q, a: a, t: Date.now() }])
    memory = next
    memoryFile.setText(JSON.stringify(next, null, 2))
  }

  FileView {
    id: memoryFile
    path: root.stateDir + "/memory.json"
    printErrors: false
    onLoaded: {
      try {
        root.memory = JSON.parse(text()) || {}
      } catch (e) {
        root.memory = {}
      }
    }
  }

  Component.onCompleted: Quickshell.execDetached(["mkdir", "-p", root.stateDir])

  // ------------------------------------------------------------ IPC：omarchy-shell lia.pet <method> [arg]
  IpcHandler {
    target: "lia.pet"

    function event(json: string): string {
      return root.handleEvent(json)
    }
    function say(text: string): string {
      root.speak("", text, "", "info")
      return "ok"
    }
    function play(name: string): string {
      root.playRequest("", name)
      return "ok"
    }
    function usage(): string {
      root.showUsage(true)
      return "ok"
    }
    function whisper(): string {
      return root.requestWhisper("")
    }
    function chat(text: string): string {
      return root.requestChat("", text)
    }
    function reload(): string {
      root.reloadConfig()
      return "ok"
    }
    function toggle(): string {
      root.hidden = !root.hidden
      return root.hidden ? "hidden" : "shown"
    }
    function state(): string {
      return JSON.stringify({
        ready: root.ready,
        hidden: root.hidden,
        configError: root.configError,
        pets: root.pets.map(function(p) { return p.id }),
        workStatus: root.workStatus,
        sessions: root.wsStore.sessions,
        lastAgent: root.lastAgent,
        usage: root.usageSummaries,
        llmBusy: llm.busy,
        whisperAuto: root.config.whisperAuto === true
      })
    }
  }

  // ------------------------------------------------------------ 每块屏一个透明 overlay
  function screenName(pet) {
    var screens = Quickshell.screens
    if (pet.screen) {
      for (var i = 0; i < screens.length; i++) if (screens[i].name === pet.screen) return pet.screen
    }
    return screens.length ? screens[0].name : ""
  }

  function petsForScreen(screen) {
    return pets.filter(function(p) { return screenName(p) === screen.name })
  }

  Variants {
    model: root.ready ? Quickshell.screens.filter(function(s) { return root.petsForScreen(s).length > 0 }) : []

    PetOverlay {
      required property var modelData
      screen: modelData
      service: root
      pets: root.petsForScreen(modelData)
    }
  }
}
