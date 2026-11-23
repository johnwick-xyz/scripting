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
      <List navigationTitle="中国电信">
        <Section header={<Text>Cookie</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴电信 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
        </Section>
        <Section header={<Text>怎么拿 Cookie</Text>}>
          <Text foregroundStyle="secondaryLabel">
            1. 先手动把电信 Cookie 粘贴到上面就能用，过期后重新抓一次。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            2. Loon 抓取：装好 Telecom.lpx 后，打开中国电信 App 刷一次首页或套餐页，Cookie 会自动写进 BoxJs，小组件会自动从 BoxJs 读，不用填这里。
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
