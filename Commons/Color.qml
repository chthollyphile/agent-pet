pragma Singleton
import QtQuick

// 独立模式的默认主题。`qs.Commons` 解析到当前 shell 的根目录：
// 作为 Omarchy 插件运行时用的是 Omarchy 自己的 Commons（跟随主题），这里的文件只在独立模式生效。
// 只提供菜单和对话框用到的颜色。
QtObject {
  property color foreground: "#cdd6f4"
  property color background: "#1e1e2e"
  property color accent: "#89b4fa"
  property color muted: "#7f849c"

  readonly property QtObject menu: QtObject {
    property color background: "#1e1e2e"
    property color text: "#cdd6f4"
    property color border: "#45475a"
    property color selectedBackground: "#313244"
    property color selectedText: "#89b4fa"
  }

  readonly property QtObject popups: QtObject {
    property color background: "#1e1e2e"
    property color text: "#cdd6f4"
    property color border: "#45475a"
  }
}
