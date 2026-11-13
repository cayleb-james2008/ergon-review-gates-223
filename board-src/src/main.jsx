import '@fontsource-variable/geist';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { createAdapter } from './data/index.js';
import { App } from './App';
import { Board } from './components/Board';
import { Header } from './components/Header';

const root = createRoot(document.getElementById('root'));
let adapter;
try {
  adapter = await createAdapter();
} catch (e) {
  console.error(e); // the technical text stays in the console; staff get a plain sentence
  root.render(
    <div className="app">
      <Header liveText="" conn="error" connLabel="Error" testMode={false} />
      <Board view={{ failedFirstLoad: true, fatal: 'Ask the person who looks after it.', rows: [] }} ctx={{}} noMatch={false} data={{}} />
    </div>,
  );
  throw e;
}
root.render(<App adapter={adapter} />);
