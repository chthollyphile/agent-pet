// 独立模式入口：不依赖 Omarchy，用 `qs -p <本目录>` 启动。
// 作为 Omarchy 插件运行时不会用到这个文件：omarchy-shell 直接加载 Service.qml。
import Quickshell

ShellRoot {
  Service {}
}
