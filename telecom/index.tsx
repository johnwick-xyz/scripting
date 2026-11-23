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
  const [loginUrl, setLoginUrl] = useState<string>('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (FileManager.existsSync(prefPath)) {
      try {
        const pref = JSON.parse(FileManager.readAsStringSync(prefPath) || '{}')
        if (pref.cookie) setCookie(pref.cookie)
        if (pref.loginUrl) setLoginUrl(pref.loginUrl)
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
    FileManager.writeAsStringSync(prefPath, JSON.stringify({ cookie, loginUrl }))
    Widget.reloadAll()
  }, [cookie, loginUrl, loaded])

  return (
    <NavigationStack>
      <List navigationTitle="中国电信">
        <Section header={<Text>登录地址（首选，不怕过期）</Text>}>
          <HStack>
            <Text>登录地址</Text>
            <SecureField title="粘贴 e.dlife.cn 登录地址..." value={loginUrl} onChanged={setLoginUrl} />
          </HStack>
        </Section>
        <Section header={<Text>Cookie（备用）</Text>}>
          <HStack>
            <Text>Cookie</Text>
            <SecureField title="粘贴电信 Cookie..." value={cookie} onChanged={setCookie} />
          </HStack>
        </Section>
        <Section header={<Text>怎么拿登录地址</Text>}>
          <Text foregroundStyle="secondaryLabel">
            1. Loon 里装好 Telecom.lpx（已含登录地址规则），保持开启。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            2. Safari 打开 https://e.dlife.cn/index.do 登录一次，跳转时收到“电信登录地址已获取”就好了；小组件每次刷新自动用它换新 Cookie。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            3. 登录页一直在转圈：先把 Loon 关掉再登录，登完开 Loon 刷新一次页面；或先去 www.189.cn 登录，再回 e.dlife.cn。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            4. 没抓到之前也可以先在上面手动粘贴 Cookie，过期后重新抓一次。
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
