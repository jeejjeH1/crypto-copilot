require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── Twitter Proxy (full page) ──
app.get('/proxy/twitter', async (req, res) => {
  const url = req.query.url || 'https://x.com';
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      redirect: 'follow',
    });
    let html = await r.text();
    // Rewrite relative URLs to absolute
    html = html.replace(/(src|href|action)="(\/[^"]+)"/g, `$1="https://x.com$2"`);
    html = html.replace(/(src|href|action)='(\/[^']+)'/g, `$1='https://x.com$2'`);
    // Remove Content-Security-Policy that blocks iframe
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('خطا در دریافت توییتر: ' + e.message);
  }
});

// ── AI (OpenRouter) — key from user ──
app.post('/api/ai', async (req, res) => {
  const { system, user, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://x.com',
        'X-Title': 'Crypto Copilot Mini'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        temperature: 0.9,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user || '' }
        ]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error?.message || JSON.stringify(data.error) });
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CoinGecko prices ──
const TOP_COINS = {
  btc:'bitcoin',bitcoin:'bitcoin',eth:'ethereum',ethereum:'ethereum',ether:'ethereum',
  sol:'solana',solana:'solana',bnb:'binancecoin',xrp:'ripple',ada:'cardano',
  doge:'dogecoin',avax:'avalanche-2',dot:'polkadot',link:'chainlink',uni:'uniswap',
  aave:'aave',atom:'cosmos',ltc:'litecoin',near:'near',apt:'aptos',arb:'arbitrum',
  op:'optimism',sui:'sui',pepe:'pepe',shib:'shiba-inu',trx:'tron',fil:'filecoin',
  rndr:'render-token',fet:'fetch-ai',ondo:'ondo-finance',jup:'jupiter-exchange-solana',
  tao:'bittensor',kas:'kaspa',xlm:'stellar',algo:'algorand',hbar:'hedera-hashgraph',
  vet:'vechain',theta:'theta-token',crv:'curve-dao-token',mkr:'maker',ldo:'lido-dao',
  ens:'ethereum-name-service',stx:'blockstack',tia:'celestia',dym:'dymension',
  strk:'starknet',wif:'dogwifcoin',bonk:'bonk',floki:'floki',gala:'gala',
  sand:'the-sandbox',mana:'decentraland',chz:'chiliz',xmr:'monero',bch:'bitcoin-cash',
  etc:'ethereum-classic',eos:'eos',matic:'matic-network',polygon:'matic-network'
};

app.get('/api/prices', async (req, res) => {
  const text = (req.query.text || '').toLowerCase();
  const found = new Map();
  const tickers = text.match(/\$([a-z]{2,10})/g);
  if (tickers) for (const m of tickers) {
    const t = m.replace('$','').trim();
    if (TOP_COINS[t]) found.set(TOP_COINS[t], t);
  }
  for (const [key, id] of Object.entries(TOP_COINS)) {
    if (key.length >= 3 && !found.has(id)) {
      try { if (new RegExp('\\b'+key+'\\b','i').test(text)) found.set(id, key); } catch(e){}
    }
  }
  if (tickers) {
    for (const m of tickers.slice(0,3)) {
      const t = m.replace('$','').trim();
      if (!TOP_COINS[t] && t.length >= 3) {
        try {
          const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(t)}`);
          const d = await r.json();
          if (d.coins?.length) {
            const best = d.coins.find(c => c.symbol.toLowerCase() === t) || d.coins[0];
            found.set(best.id, best.symbol);
          }
        } catch(e){}
      }
    }
  }
  const ids = [...found.keys()].slice(0, 5);
  if (!ids.length) return res.json({ coins: [] });
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    const prices = await r.json();
    const result = ids.map(id => ({
      id, name: found.get(id),
      usd: prices[id]?.usd || 0,
      change: prices[id]?.usd_24h_change || 0
    }));
    res.json({ coins: result });
  } catch(e) {
    res.json({ coins: [] });
  }
});

// ── Telegram WebApp init validation ──
app.post('/api/verify', (req, res) => {
  res.json({ ok: true });
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Crypto Copilot Mini running on port ${PORT}`));
