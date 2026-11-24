import type { Ctx } from '../core/Scene';
import type { Timeline } from '../core/Timeline';
import { BullScene, StatsScene } from './RedScenes';
import { MoneyScene } from './MoneyScenes';
import { BanknoteScene } from './BanknoteScene';
import { LettersScene } from './LettersScene';
import { Gate2Scene } from './Gate2Scene';
import { SkyScene } from './SkyScene';
import { CityScene } from './CityScene';

export function registerLaterScenes(ctx: Ctx, tl: Timeline) {
  tl.add(new BullScene(ctx)).add(new StatsScene(ctx)).add(new BanknoteScene(ctx)).add(new MoneyScene(ctx)).add(new LettersScene(ctx)).add(new Gate2Scene(ctx)).add(new SkyScene(ctx)).add(new CityScene(ctx));
}
