// "Blueprint vs built": what the .tf files ask for (blue, your machine) next to what OpenTofu has
// built (green, recorded in terraform.tfstate). After a plan, each item carries its plan symbol:
// + create and ~ change (amber, waiting), -/+ replace and − destroy (red, always with an icon).
import type { PictureItem, TofuPicture } from '~/engine/tofu-sim';
import { DangerIcon } from './AreaIcons';
import { cx, type T } from './shared';

const SYMBOL: Record<NonNullable<PictureItem['mark']>, string> = { create: '+', update: '~', delete: '−', replace: '-/+', cbd: '+/-' };

function Mark({ t, mark }: { t: T; mark: PictureItem['mark'] }) {
  if (!mark) return null;
  const danger = mark === 'delete' || mark === 'replace' || mark === 'cbd';
  return (
    <span className={cx('tofu-mark', `tofu-mark-${mark}`)}>
      {danger && <DangerIcon />}
      <span aria-hidden="true">{SYMBOL[mark]} </span>
      {t(`tofu.mark.${mark}`)}
    </span>
  );
}

export default function TofuBoard({ t, picture }: { t: T; picture: TofuPicture }) {
  const builtSet = new Set(picture.built.map((b) => b.addr));
  return (
    <figure className="tofu-board" aria-label={t('tofu.board')}>
      <div className="tofu-cols">
        <section className="tofu-col tofu-blueprint">
          <h4 className="tofu-col-head">
            <span aria-hidden="true">📐 </span>
            {t('tofu.blueprint')}
            <span className={cx('tofu-pill', picture.initialized ? 'is-on' : 'is-off')}>{t(picture.initialized ? 'tofu.initDone' : 'tofu.initNotYet')}</span>
          </h4>
          {picture.broken ? (
            <p className="tofu-empty">
              <DangerIcon /> {t('tofu.broken')}
            </p>
          ) : picture.blueprint.length ? (
            <ul className="tofu-items pop-in">
              {picture.blueprint.map((it, i) => (
                <li key={it.addr} className={cx('tofu-item', !builtSet.has(it.addr) && 'is-unbuilt', it.mark && `is-${it.mark}`)} style={{ '--sibling-index': i + 1 } as React.CSSProperties}>
                  <code className="tofu-addr">{it.addr}</code>
                  <Mark t={t} mark={it.mark} />
                  {!builtSet.has(it.addr) && !it.mark && <span className="tofu-note">{t('tofu.notBuilt')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tofu-empty">{t('tofu.noBlueprint')}</p>
          )}
        </section>
        <section className="tofu-col tofu-built">
          <h4 className="tofu-col-head">
            <span aria-hidden="true">🏗️ </span>
            {t('tofu.built')}
            {picture.serial !== null && <span className="tofu-pill is-state">{t('tofu.serial', { n: picture.serial })}</span>}
          </h4>
          {picture.built.length ? (
            <ul className="tofu-items pop-in">
              {picture.built.map((it, i) => (
                <li key={it.addr} className={cx('tofu-item', 'is-built', it.mark && `is-${it.mark}`)} style={{ '--sibling-index': i + 1 } as React.CSSProperties}>
                  <code className="tofu-addr">{it.addr}</code>
                  <Mark t={t} mark={it.mark} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="tofu-empty">{t('tofu.noBuilt')}</p>
          )}
          {picture.outputs.length > 0 && (
            <dl className="tofu-outputs">
              {picture.outputs.map((o) => (
                <div key={o.name} className="tofu-output">
                  <dt>{o.name}</dt>
                  <dd>{o.sensitive ? t('tofu.sensitive') : o.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
      <figcaption className="tofu-summary">
        {t('tofu.summary', { blueprint: picture.blueprint.length, built: picture.built.length })}
      </figcaption>
    </figure>
  );
}
