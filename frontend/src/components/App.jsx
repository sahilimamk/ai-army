import { useState } from 'react';
import WarRoom from './WarRoom.jsx';
import Launchpad from './Launchpad.jsx';
import SettingsPanel from './SettingsPanel.jsx';

export default function App() {
  const [tab, setTab] = useState('war');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span> AI ARMY COMMAND
        </div>
        <nav className="tabs">
          {[
            ['war', 'War Room'],
            ['launchpad', 'Launchpad'],
            ['settings', 'Settings'],
          ].map(([id, label]) => (
            <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {tab === 'war' && <WarRoom />}
        {tab === 'launchpad' && <Launchpad />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
