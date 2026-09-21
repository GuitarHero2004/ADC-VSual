import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connectFloating } from './floating-client.ts';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('Missing companion root');
const root = createRoot(element);
let disposed = false;
let disconnect = () => {};
let unsubscribe = () => {};
const dispose = () => {
  if (disposed) return;
  disposed = true;
  // Dispose session controllers before the host removes the frame.
  root.unmount();
  unsubscribe();
  disconnect();
};
window.addEventListener('pagehide', dispose, { once: true });
window.addEventListener('beforeunload', dispose, { once: true });

void connectFloating()
  .then((client) => {
    if (disposed) {
      client.dispose();
      return;
    }
    disconnect = () => client.dispose();
    unsubscribe = client.subscribe((event) => {
      if (event.type === 'ended') dispose();
    });
    root.render(
      <StrictMode>
        <App
          floating={client}
          onEnd={() => {
            // Teardown is synchronous; a later provider result cannot become audible.
            disconnect = () => {
              client.close();
              client.dispose();
            };
            dispose();
          }}
        />
      </StrictMode>,
    );
  })
  .catch(() => {
    if (disposed) return;
    root.render(
      <p role="status">
        VSual is unavailable here. Reopen it using the extension button. / Không
        thể mở VSual ở đây. Hãy mở lại bằng nút tiện ích.
      </p>,
    );
  });
