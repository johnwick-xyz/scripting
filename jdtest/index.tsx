import { List, Navigation, NavigationStack, Script, Text } from 'scripting'

Navigation.present({
  element: (
    <NavigationStack>
      <List navigationTitle="京东测试">
        <Text>这是一个不联网的测试小组件，只用来看预览能不能出来。</Text>
      </List>
    </NavigationStack>
  ),
})
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
