import QtQuick
import Quickshell
import Quickshell.Io
import "lib/automation.mjs" as Auto
import "lib/work-status.mjs" as WS

// 自动化：整点报时、定时任务、事件触发规则（配置见 lib/automation.mjs 开头）。
// 调度按墙上时钟每 15 秒检查一次，挂起恢复后不会错乱。
// run 命令带 AGENT_PET_INTERNAL=1（命令里再调 claude / codex 不会回灌成工作状态事件），
// 事件内容只走 stdin（JSON），不进进程参数。
Scope {
  id: auto

  property var service: null

  readonly property var norm: Auto.normalize(service ? service.config.automations : null)
  onNormChanged: norm.errors.forEach(function(e) { console.warn("[agent-pet] automations." + e) })

  // 调度状态（Auto.tick 就地更新）、规则冷却、任务上次输出、正在跑的任务
  property var sched: ({})
  property var ruleFiredAt: ({})
  property var taskOutput: ({})
  property var taskRunning: ({})

  function busy() {
    return WS.anyBusy(service.wsStore)
  }

  function pickAnim(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : ""
  }

  // 说话 + 播动画；text 为空只播动画
  function act(petId, text, anims) {
    var name = pickAnim(anims)
    if (name) service.playRequest(petId, name)
    if (text) service.speak(petId, text, "", "info")
  }

  // ------------------------------------------------------------ 调度
  Timer {
    interval: 15000
    running: auto.service && auto.service.ready
    repeat: true
    triggeredOnStart: true
    onTriggered: {
      var out = Auto.tick(auto.sched, auto.norm, Date.now())
      if (out.chime >= 0) auto.chime(out.chime)
      out.tasks.forEach(function(key) { auto.runTask(key, false) })
    }
  }

  function chime(hour) {
    var c = norm.chime
    var now = new Date()
    var text = Auto.render(c.text || service.tr("chimeText"), { hour: hour, time: Qt.formatTime(now, "HH:mm") })
    // agent 正在干活时只冒气泡，不打断工作状态动画
    act("", text, c.quietWhenBusy && busy() ? [] : Auto.chimeAnims(c.anims, hour))
  }

  // ------------------------------------------------------------ 定时任务
  function findTask(key) {
    for (var i = 0; i < norm.tasks.length; i++) if (norm.tasks[i].key === key) return norm.tasks[i]
    return null
  }

  // manual = IPC 手动触发：忽略 skipWhenBusy，并且总是说出结果
  function runTask(key, manual) {
    var t = findTask(key)
    if (!t) return "no-task"
    if (taskRunning[key]) return "running"
    if (!manual && t.skipWhenBusy && busy()) return "busy"
    if (!t.run) {
      act(t.pet, Auto.render(t.say, { name: t.key }), t.play)
      return "ok"
    }
    var r = Object.assign({}, taskRunning)
    r[key] = true
    taskRunning = r
    spawn(t.run, "", service.home, t.timeoutSec, function(output, exitCode) {
      var r2 = Object.assign({}, auto.taskRunning)
      delete r2[key]
      auto.taskRunning = r2
      var prev = auto.taskOutput[key]
      var outs = Object.assign({}, auto.taskOutput)
      outs[key] = output
      auto.taskOutput = outs
      if (!manual && !Auto.taskShouldSpeak(t.when, output, exitCode, prev)) return
      auto.act(t.pet, Auto.render(t.say, { name: t.key, output: output, exit: exitCode }), t.play)
    })
    return "ok"
  }

  // ------------------------------------------------------------ 事件规则
  function onEvent(ev) {
    var now = Date.now()
    norm.rules.forEach(function(rule) {
      if (!Auto.matchRule(rule, ev)) return
      var last = auto.ruleFiredAt[rule.key]
      if (rule.cooldownSec > 0 && last && now - last < rule.cooldownSec * 1000) return
      var fired = Object.assign({}, auto.ruleFiredAt)
      fired[rule.key] = now
      auto.ruleFiredAt = fired
      var vars = Auto.eventVars(ev)
      if (!rule.run) {
        auto.act(rule.pet, Auto.render(rule.say, vars), rule.play)
        return
      }
      var dir = ev.cwd || auto.service.home
      auto.spawn(rule.run, JSON.stringify(ev), dir, rule.timeoutSec, function(output, exitCode) {
        auto.act(rule.pet, Auto.render(rule.say, Object.assign({ output: output, exit: exitCode }, vars)), rule.play)
      })
    })
  }

  // ------------------------------------------------------------ 运行命令
  // 每次运行一个独立进程，跑完自毁；超时先 SIGTERM
  function spawn(command, input, dir, timeoutSec, done) {
    var r = runner.createObject(auto, { command: command, input: input, dir: dir, timeoutMs: timeoutSec * 1000, done: done })
    if (!r) console.warn("[agent-pet] automations: 无法创建进程")
  }

  Component {
    id: runner

    Scope {
      id: job
      property var command: []
      property string input: ""
      property string dir: ""
      property int timeoutMs: 30000
      property var done: null
      property int exitCode: -1
      property bool finished: false

      Component.onCompleted: {
        proc.command = job.command
        proc.workingDirectory = job.dir
        proc.stdinEnabled = true
        proc.running = true
        kill.interval = job.timeoutMs
        kill.start()
      }

      Process {
        id: proc
        environment: ({ AGENT_PET_INTERNAL: "1" })
        stdout: StdioCollector { id: out }
        stderr: StdioCollector { id: err }
        // 写完立即关闭 stdin，读 stdin 的命令拿到 EOF
        onStarted: {
          write(job.input)
          stdinEnabled = false
        }
        onExited: function(code) {
          job.exitCode = code
        }
        // 启动失败时只有 runningChanged、没有 exited，所以在这里收尾
        onRunningChanged: {
          if (running || job.finished) return
          job.finished = true
          kill.stop()
          var text = Auto.cleanOutput(out.text) || (job.exitCode !== 0 ? Auto.cleanOutput(err.text) : "")
          if (job.exitCode !== 0) console.warn("[agent-pet] automations: " + job.command.join(" ") + " 退出码 " + job.exitCode)
          try {
            if (job.done) job.done(text, job.exitCode)
          } catch (e) {
            console.warn("[agent-pet] automations:", e)
          }
          job.destroy()
        }
      }

      Timer {
        id: kill
        onTriggered: proc.signal(15)
      }
    }
  }
}
