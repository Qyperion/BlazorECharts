import { EChartsError } from './errors.ts';

/** Managed acceptance identity and browser render epoch are separate from stable/finished signals. */
export class ChartCommands {
  generation = 1;
  revision = 0;
  sequence = 0;
  renderRevision = 0;

  accept(generation?: number | null, revision?: number | null, sequence?: number | null, recreate = false, renders = true): void {
    if (generation != null && sequence != null) {
      if (sequence <= this.sequence || (this.sequence > 0 && generation !== this.generation + (recreate ? 1 : 0)))
        throw new EChartsError('ChartCommandStale', 'The command belongs to an obsolete generation or acceptance sequence.');

      this.generation = generation;
      this.sequence = sequence;
      this.revision = revision ?? sequence;
    } else {
      if (recreate)
        this.generation++;

      this.revision++;
      this.sequence++;
    }

    if (renders)
      this.renderRevision++;
  }
}
