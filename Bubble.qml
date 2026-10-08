import QtQuick

// 头顶气泡：白底圆角 + 小尾巴，可带一张表情包。显示时可点击（Pet 把它加进 overlay 的输入区域）。
// 样式取自 dsh-pet 的 bubble.ts（白 92%、#2b2b2b）。
Item {
  id: bubble

  property var content: null // { text, meme, page }：page = 分段气泡的页码，如 "1/3"
  property url memeDir
  // 字体：fontFile（字体文件路径）> fontFamily（已安装字体名）> sans-serif
  property string fontFamily: ""
  property string fontFile: ""
  property int fontSize: 14
  property real tailX: width / 2
  property real maxTextWidth: 240

  signal clicked()

  // 淡出期间保留最后一份内容，避免先清空再消失
  property var shownContent: null
  onContentChanged: if (content) shownContent = content

  readonly property bool active: content !== null && content !== undefined
  opacity: active ? 1 : 0
  visible: opacity > 0
  Behavior on opacity {
    NumberAnimation {
      duration: 160
    }
  }

  readonly property int pad: 10
  width: body.width
  height: body.height + tail.height / 2

  FontLoader {
    id: loader
    source: bubble.fontFile ? "file://" + bubble.fontFile : ""
  }

  readonly property string resolvedFamily: loader.status === FontLoader.Ready ? loader.name
    : bubble.fontFamily || "sans-serif"

  Rectangle {
    id: body
    width: Math.max(label.width, meme.visible ? meme.width : 0) + bubble.pad * 2
    height: column.height + bubble.pad * 2
    radius: 12
    color: Qt.rgba(1, 1, 1, 0.94)
    border.color: Qt.rgba(0.17, 0.17, 0.17, 0.12)

    Column {
      id: column
      x: bubble.pad
      y: bubble.pad
      spacing: 6

      Text {
        id: label
        text: bubble.shownContent ? bubble.shownContent.text : ""
        // 内容来自 agent 会话和模型输出，不可信：一律按纯文本显示。
        // 默认的 AutoText 在首行像 HTML 时会按富文本解析，<img> 里的远程地址会被直接请求。
        textFormat: Text.PlainText
        color: "#2b2b2b"
        font.family: bubble.resolvedFamily
        font.pixelSize: bubble.fontSize
        lineHeight: 1.25
        wrapMode: Text.Wrap
        width: Math.min(implicitWidth, bubble.maxTextWidth)
      }

      // 分段页码：右下角小字
      Text {
        id: page
        readonly property string value: bubble.shownContent && bubble.shownContent.page ? bubble.shownContent.page : ""
        visible: value !== ""
        text: value
        textFormat: Text.PlainText
        color: "#8a8a8a"
        font.family: bubble.resolvedFamily
        font.pixelSize: Math.max(9, bubble.fontSize - 3)
        width: label.width
        horizontalAlignment: Text.AlignRight
      }

      Image {
        id: meme
        readonly property string name: bubble.shownContent && bubble.shownContent.meme ? bubble.shownContent.meme : ""
        visible: name !== "" && status === Image.Ready
        source: name ? bubble.memeDir + name + ".png" : ""
        width: 110
        height: visible ? width * (implicitHeight / Math.max(1, implicitWidth)) : 0
        fillMode: Image.PreserveAspectFit
        smooth: true
        asynchronous: true
      }
    }
  }

  MouseArea {
    anchors.fill: parent
    enabled: bubble.active
    cursorShape: Qt.PointingHandCursor
    onClicked: bubble.clicked()
  }

  Rectangle {
    id: tail
    width: 12
    height: 12
    rotation: 45
    color: body.color
    x: Math.max(body.radius, Math.min(body.width - body.radius - width, bubble.tailX - width / 2))
    y: body.height - height / 2 - 1
    z: -1
  }
}
