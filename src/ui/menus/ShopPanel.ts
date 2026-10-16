import type { GameContext } from '../../core/GameContext';
import type { ShopDef } from '../../data/types';
import { sellPrice } from '../../systems/Shops';
import { countItem, GOLD_ITEM } from '../../systems/Inventory';
import { button, el } from '../dom';
import type { Panel } from '../Overlays';
import { bindT } from './ConfirmPanel';

export type BuyResult = 'bought' | 'notEnough' | 'soldOut';
export type SellResult = 'sold' | 'none';
type ShopEntry = ShopDef['items'][number];

/**
 * A shop (any merchant from npcs.json): every item with its price, stock and how many you
 * already have, a Buy button and a Sell button (one at a time, at price x sellRatio). Your gold shows at the top. The game waits while it is open.
 * Item names and "Gold" stay English (data, not text keys).
 */
export function shopPanel(
  ctx: GameContext,
  merchant: string,
  shop: ShopDef,
  buy: (entry: ShopEntry) => BuyResult,
  sell: (entry: ShopEntry) => SellResult,
  /** How many are in stock right now (null = unlimited). */
  stockOf: (entry: ShopEntry) => number | null,
  onClose: () => void,
): Panel {
  // The last purchase (or why it failed), kept while the panel redraws.
  let message = '';
  return {
    build: () => {
      const { t } = bindT(ctx);
      const character = ctx.session?.character;
      const items = new Map(ctx.data?.items.items.map((item) => [item.id, item]) ?? []);
      const gold = items.get(GOLD_ITEM)?.name ?? 'Gold';
      const rows = shop.items.map((entry) => {
        const def = items.get(entry.item);
        const name = def?.name ?? entry.item;
        const owned = countItem(character?.inventory ?? [], entry.item);
        const left = stockOf(entry);
        const give = sellPrice(entry, shop);
        return el(
          'li',
          { className: 'ui-bag-row' },
          el(
            'div',
            { className: 'ui-bag-item' },
            el('span', { className: 'ui-bag-name', text: name }),
            el('span', {
              className: 'ui-shop-price',
              text: t('shop.price', { price: entry.price, gold }),
            }),
            def?.description
              ? el('span', { className: 'ui-bag-desc', text: t(def.description) })
              : null,
            left !== null
              ? el('span', {
                  className: 'ui-bag-desc',
                  text: left > 0 ? t('shop.stock', { count: left }) : t('shop.soldOut'),
                })
              : null,
            owned > 0
              ? el('span', { className: 'ui-bag-desc', text: t('shop.owned', { count: owned }) })
              : null,
          ),
          el('button', {
            className: 'ui-chip',
            text: t('shop.buy'),
            attrs: { type: 'button', 'aria-label': `${t('shop.buy')}: ${name}` },
            onClick: () => {
              const result = buy(entry);
              message =
                result === 'bought'
                  ? t('shop.bought', { item: name })
                  : result === 'soldOut'
                    ? t('shop.soldOut')
                    : t('shop.notEnough', { gold });
              ctx.overlays.refreshTop();
            },
          }),
          give > 0
            ? el('button', {
                className: 'ui-chip',
                text: t('shop.sell', { price: give, gold }),
                attrs: {
                  type: 'button',
                  'aria-label': `${t('shop.sell', { price: give, gold })}: ${name}`,
                },
                onClick: () => {
                  message =
                    sell(entry) === 'sold'
                      ? t('shop.sold', { item: name, price: give, gold })
                      : t('shop.nothingToSell', { item: name });
                  ctx.overlays.refreshTop();
                },
              })
            : null,
        );
      });
      return el(
        'div',
        { className: 'ui-panel ui-menu ui-bag ui-shop', attrs: { role: 'dialog' } },
        el('h2', { className: 'ui-heading', text: `${t('shop.title')} · ${merchant}` }),
        el(
          'div',
          { className: 'ui-bag-stats' },
          el(
            'span',
            { className: 'ui-bag-gold' },
            el('span', { className: 'ui-hud-gold-coin' }),
            `${character?.gold ?? 0} ${gold}`,
          ),
        ),
        el('ul', { className: 'ui-bag-list' }, ...rows),
        el('p', { className: 'ui-shop-message', attrs: { 'aria-live': 'polite' }, text: message }),
        button(t('common.close'), () => ctx.overlays.close(), true),
      );
    },
    onClose,
  };
}
