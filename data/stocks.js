// 關注清單。順序就是首頁卡片的順序。
// 觀察條件由程式依行情自動判斷，可用的 type 見 CLAUDE.md 第六節。
ETF.addStocks([
  {
    code: '0050',
    name: '元大台灣50',
    kind: 'ETF・市值型',
    status: '關注中',
    why: '（示範）當作大盤的代表，用來對照其他標的的強弱。',
    conditions: [
      { type: 'close_below', value: 95, label: '收盤跌破 95 元' },
      { type: 'volume_ratio_above', value: 2, label: '成交量達前五日均量 2 倍' }
    ]
  },
  {
    code: '2330',
    name: '台積電',
    kind: '個股・半導體',
    status: '關注中',
    why: '（示範）0050 的最大成分股，想觀察它和 0050 的連動程度。',
    conditions: [
      { type: 'close_above', value: 2400, label: '收盤站上 2,400 元' },
      { type: 'change_pct_below', value: -4, label: '單日跌幅達 4%' }
    ]
  },
  {
    code: '00878',
    name: '國泰永續高股息',
    kind: 'ETF・高股息',
    status: '關注中',
    why: '（示範）想驗證「高股息 ETF 波動比市值型小」這個印象是否成立。',
    conditions: [
      { type: 'close_below', value: 32, label: '收盤跌破 32 元' },
      { type: 'volume_ratio_above', value: 2, label: '成交量達前五日均量 2 倍' }
    ]
  },
  {
    code: '2454',
    name: '聯發科',
    kind: '個股・半導體',
    status: '關注中',
    why: '大盤',
    conditions: []
  }
]);
