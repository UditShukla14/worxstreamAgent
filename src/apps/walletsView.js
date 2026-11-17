import { listWallets as listNovaWallets } from '../analytics/novaWallet.js';
import { listRavenWalletRows } from './appWallet.js';

/**
 * Wallets of the AI apps in one list, each row tagged with its `app`. Nova rows come from the Nova wallet, Raven rows from
 * the Raven app wallet; a company with both appears twice, because each app is paid for from its own balance.
 * @param {'nova'|'raven'|''} [app] limit to one app; empty = both
 */
export async function listAllWallets(app = '') {
  const [nova, raven] = await Promise.all([
    app === 'raven' ? [] : listNovaWallets(),
    app === 'nova' ? [] : listRavenWalletRows(),
  ]);
  return [...nova.map((w) => ({ app: 'nova', ...w })), ...raven];
}
