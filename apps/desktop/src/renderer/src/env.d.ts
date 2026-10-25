import type { MainApi } from '../../preload/index.ts';

declare global {
  interface Window {
    main: MainApi;
  }
}
