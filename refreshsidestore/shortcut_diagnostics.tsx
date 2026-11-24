import { Button, Text, VStack, Widget } from "scripting"

export function ShortcutDiagnostics() {
  const count = Widget.shortcutCount
  // Device experiment requested by the user; "none" is not in the synced ButtonStyle union.
  // @ts-expect-error Keep this unsupported style isolated to the diagnostic button for the device test.
  const actionButton = <Button shortcutIndex={0} buttonStyle="none">
    <Text font={11} fontWeight="semibold" foregroundStyle="white" frame={{ width: 124, height: 30 }}
      background={{ style: "#2788C5", shape: { type: "rect", cornerRadius: 8 } }}>
      运行动作0
    </Text>
  </Button>
  return <VStack spacing={5} padding={8}
    widgetBackground={{ light: "#F7F9FA", dark: "#282828" }}>
    <Text font={12} fontWeight="semibold">快捷方式诊断</Text>
    <Text font={11}>系统读到 {typeof count === "number" ? count : "未知"} 个动作</Text>
    {actionButton}
    {/* 单按钮实验：暂时停用第二个系统动作。
    <Button title="动作1" shortcutIndex={1} buttonStyle="borderedProminent" />
    */}
    {/* 单按钮实验：暂时停用本地计数按钮。
    <Button title="本地点击计数 +1" intent={DiagnosticTapIntent(undefined)} />
    */}
    <Text font={9} foregroundStyle="secondaryLabel">返回原组件：清空参数</Text>
  </VStack>
}
