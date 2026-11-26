import { render } from '@solidjs/web';
import App from './App';
import { BoardStore, createBoardStore } from './store';
import type { BoardTransport } from './api';

export function mountBoard(
  root: HTMLElement,
  transport: BoardTransport,
  copy: (text: string) => Promise<unknown>,
) {
  return render(() => {
    const store = createBoardStore(transport, copy);
    return (
      <BoardStore value={store}>
        <App />
      </BoardStore>
    );
  }, root);
}
