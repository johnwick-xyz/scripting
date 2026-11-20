import {
  Button,
  HStack,
  List,
  Navigation,
  NavigationStack,
  Path,
  Script,
  Section,
  SecureField,
  Text,
  Widget,
  useEffect,
  useState,
} from 'scripting'

const root = Path.join(FileManager.appGroupDocumentsDirectory, Script.name)
const prefPath = Path.join(root, 'preference.json')

function App() {
  const [cookie, setCookie] = useState<string>('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (FileManager.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.cookie) setCookie(pref.cookie)
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
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ cookie }))
    Widget.reloadAll()
  }, [cookie, loaded])

  return (
    <NavigationStack>
      <List navigationTitle="中国联通">
        <Section header={<Text>Cookie</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴联通 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
        </Section>
        <Section header={<Text>怎么拿 Cookie</Text>}>
          <Text foregroundStyle="secondaryLabel">
            1. Loon 装好 BoxJs，用重写抓一次：打开联通 App 首页 -&gt; 剩余流量 -&gt;
            语音，小组件会自动从 BoxJs 读，不用填这里。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            2. 也可以手动把抓到的完整 Cookie 粘贴到上面，Cookie 里要有 JSESSIONID，过期后重新抓一次。
          </Text>
        </Section>
        <Section>
          <Button title="预览小组件" action={() => Widget.preview()} />
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
