import {
  Button,
  List,
  Navigation,
  NavigationStack,
  Section,
  Text,
  fetch,
  useState,
} from 'scripting'

// 诊断用：在 Scripting App 里跑，不是小组件
// 依次试 BoxJs 的几个地址，看哪个能读到 Cookie
// 只显示长度和前 10 个字符，不会把完整 Cookie 显示出来

const URLS = [
  'http://boxjs.com/query/data/@YaYa_10010.cookie',
  'https://boxjs.com/query/data/@ChinaUnicom.10010v4.cookie',
  'http://boxjs.com/query/data/@ChinaUnicom.10010v4.cookie',
  'http://boxjs.com/query/data/unicom_cookie',
  'https://boxjs.com/query/data/unicom_cookie',
]

function mask(v: string) {
  if (!v) return '（空）'
  return `长度 ${v.length}，开头 ${v.slice(0, 10)}…`
}

function App() {
  const [results, setResults] = useState<string[]>(['点下面“开始测试”'])
  const [testing, setTesting] = useState(false)

  const run = async () => {
    setTesting(true)
    const out: string[] = []
    for (const url of URLS) {
      try {
        const res = await fetch(url)
        const text = await res.text()
        let val = ''
        try {
          const j = JSON.parse(text)
          val = typeof j === 'string' ? j : j.val || j.data || j.value || ''
          if (typeof val !== 'string') val = JSON.stringify(val)
        } catch (e) {
          val = text
        }
        out.push(`${url}\n  状态 ${res.status}，${val ? mask(val) : '没读到值，原文前 50 字：' + text.slice(0, 50)}`)
      } catch (e) {
        out.push(`${url}\n  报错：${String(e)}`)
      }
    }
    setResults(out)
    setTesting(false)
  }

  return (
    <NavigationStack>
      <List navigationTitle="BoxJs测试">
        <Section>
          <Button title={testing ? '测试中…' : '开始测试'} action={run} />
        </Section>
        <Section header={<Text>结果（Cookie 只显示长度和开头）</Text>}>
          {results.map((r, i) => (
            <Text key={String(i)} foregroundStyle="secondaryLabel">
              {r}
            </Text>
          ))}
        </Section>
        <Section header={<Text>怎么看</Text>}>
          <Text foregroundStyle="secondaryLabel">
            哪一行显示“长度”大于 0，就是那个 key 能读到，告诉我那一行的地址。
          </Text>
          <Text foregroundStyle="secondaryLabel">
            四行都报错 / 都没读到值，就是 BoxJs 这个地址在 Scripting 里打不通，或 key 根本不是这两个。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}

Navigation.present({ element: <App /> })
  .catch((err) => console.error(err))
  .finally(() => Script.exit())
