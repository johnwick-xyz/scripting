import { Text, VStack, Widget } from 'scripting'

Widget.present(
  <VStack padding={16}>
    <Text font={18} fontWeight="bold" foregroundStyle="label">
      测试能显示
    </Text>
    <Text font={14} foregroundStyle="secondaryLabel">
      如果这行能出来，说明小组件本身没问题，卡住的是取价那步网络
    </Text>
    <Text font={14} foregroundStyle="secondaryLabel">
      西昊豆包椅L1 ¥459.00（示例）
    </Text>
  </VStack>,
)
