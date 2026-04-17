import React, { useState } from 'react';
import './App.css';
import Home from './Home';
import Owners from './Owners';
import Votes from './Votes';
import Quotes from './Quotes';
import Fund from './Fund';

function App() {
  const [screen, setScreen] = useState('home');

  return (
    <div className="app">
      <div className="topbar">
        <div className="wordmark">Cl<em>ō</em>se</div>
        <div className="topbar-building">14 Balmoral Terrace, Partick</div>
        <span className="topbar-tag">Self-factored · 6 owners</span>
      </div>

      <div className="nav">
        <button className={screen === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('home')}>⌂ Home</button>
        <button className={screen === 'owners' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('owners')}>◎ Owners</button>
        <button className={screen === 'votes' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('votes')}>✓ Votes</button>
        <button className={screen === 'quotes' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('quotes')}>£ Quotes</button>
        <button className={screen === 'fund' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('fund')}>◈ Fund</button>
      </div>

      <div className="content">
        {screen === 'home' && <Home />}
        {screen === 'owners' && <Owners />}
        {screen === 'votes' && <Votes />}
        {screen === 'quotes' && <Quotes />}
        {screen === 'fund' && <Fund />}
      </div>
    </div>
  );
}

export default App;