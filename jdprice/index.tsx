import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Path,
  Script,
  Section,
  Text,
  TextField,
  Widget,
  useEffect,
  useState,
} from 'scripting'

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const prefPath = Path.join(root, 'preference.json')
const historyPath = Path.join(root, 'price_history.json')

function App() {
  const [sku, setSku] = useState<string>('100244780555')
  const [name, setName] = useState<string>('西昊豆包椅L1')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (FileManager.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.sku) setSku(String(pref.sku))
        if (pref.name) setName(pref.name)
      } catch (e) {
        console.error('Failed to parse preference', e)
      }
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (!FileManager.existsSync(root)) {
      FileManager.createDirectorySync(root, true)
    }
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ sku, name }))
    Widget.reloadAll()
  }, [sku, name, loaded])

  return (
    <NavigationStack>
      <List navigationTitle="京东价格监控">
        <Section header={<Text>商品</Text>}>
          <HStack>
            <Text>商品编号</Text>
            <TextField title="100244780555" value={sku} onChanged={setSku} />
          </HStack>
          <HStack>
            <Text>商品简称</Text>
            <TextField title="西昊豆包椅L1" value={name} onChanged={setName} />
          </HStack>
          <Text foregroundStyle="secondaryLabel">
            编号就是京东链接里 item.jd.com/ 后面的数字。换商品只改编号和简称，不用改代码。
          </Text>
        </Section>
        <Section header={<Text>说明</Text>}>
          <Text foregroundStyle="secondaryLabel">
            不设目标价，只看实时价和涨跌。小组件每次刷新都会把价格记进本地历史，最多存 30 条，涨跌就是和上一次记录比。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            iOS 决定刷新频率，一般 15-30 分钟一次，不是秒级实时。想马上看就点小组件打开京东页面。
          </Text>
        </Section>
        <Section>
          <Button
            title="清空价格历史"
            action={() => {
              if (FileManager.existsSync(historyPath)) {
                FileManager.removeItemSync(historyPath)
              }
              Widget.reloadAll()
            }}
          />
          <Button title="预览小组件" action={() => Widget.preview()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
