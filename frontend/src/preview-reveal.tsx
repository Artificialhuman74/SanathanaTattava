// TEMPORARY harness for eyeballing the win moment without a win in the database.
// Run `npm run dev` and open /preview-reveal.html. Delete this file and
// preview-reveal.html when done.
import React from 'react';
import ReactDOM from 'react-dom/client';
import WinReveal from './components/luckyDraw/WinReveal';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <WinReveal
    winnerName="Chiranth"
    isMe
    schemeName="Scheme 1"
    rewardProductName="Cold-Pressed Coconut Oil 1L"
    onContinue={() => console.log('continue')}
  />
);
