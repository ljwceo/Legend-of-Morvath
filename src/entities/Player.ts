import type { AppearanceFile } from '../data/types';
import type { Appearance } from '../scenes/creator';
import { CombatState, type SwordConfig } from '../systems/Combat';
import { angleDelta, MoverState } from '../systems/Movement';
import { CharacterModel } from './PlaceholderFactory';

/**
 * The player character: simulation state (MoverState, advanced by systems/Movement on the fixed
 * step) and its look (the placeholder model from the character creator). Rendering interpolates
 * between the previous and the current step, so movement looks smooth at any frame rate.
 */
export class Player {
  readonly state = new MoverState();
  /** HP, mana and the sword (fixed step). */
  readonly combat = new CombatState();
  readonly model: CharacterModel;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevHeading = 0;

  constructor(appearanceData: AppearanceFile, appearance: Appearance) {
    this.model = new CharacterModel(appearanceData);
    this.model.setAppearance(appearance);
  }

  /** Puts the player somewhere without interpolating from the old spot (spawn, teleport). */
  place(x: number, y: number, z: number, heading: number): void {
    const s = this.state;
    s.x = this.prevX = x;
    s.y = this.prevY = y;
    s.z = this.prevZ = z;
    s.heading = this.prevHeading = heading;
  }

  /** Call before each simulation step: remembers where the step started. */
  beginStep(): void {
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.prevZ = this.state.z;
    this.prevHeading = this.state.heading;
  }

  interpolatedX(alpha: number): number {
    return this.prevX + (this.state.x - this.prevX) * alpha;
  }

  interpolatedY(alpha: number): number {
    return this.prevY + (this.state.y - this.prevY) * alpha;
  }

  interpolatedZ(alpha: number): number {
    return this.prevZ + (this.state.z - this.prevZ) * alpha;
  }

  /** Moves the model to the interpolated position and heading (world coordinates). */
  syncModel(alpha: number): void {
    const root = this.model.root;
    root.position.set(
      this.interpolatedX(alpha),
      this.interpolatedY(alpha),
      this.interpolatedZ(alpha),
    );
    root.rotation.y = this.prevHeading + angleDelta(this.prevHeading, this.state.heading) * alpha;
  }

  /**
   * Draws the staff: raised while a shot is being gathered (`gathering` 0–1, see
   * StaffState.progress), otherwise held at the side. Not interpolated, like a swing.
   */
  showStaff(gathering: number): void {
    if (gathering > 0) this.model.setSwordPose('windup', gathering);
    else this.model.setSwordPose('rest', 0);
  }

  /** Draws the sword where the swing is (not interpolated: a swing is short and fast). */
  showSword(sword: SwordConfig): void {
    const c = this.combat;
    if (c.heavyWindup > 0) {
      this.model.setSwordPose('windup', 1 - c.heavyWindup / sword.heavyWindupSeconds);
    } else if (c.swingTime > 0 && c.swing !== 'none') {
      this.model.setSwordPose(c.swing, 1 - c.swingTime / sword.fastSwingSeconds);
    } else {
      this.model.setSwordPose('rest', 0);
    }
  }

  dispose(): void {
    this.model.dispose();
  }
}
