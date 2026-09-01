export type SettingsSaveResult = 'saved' | 'busy' | 'failed';

export class SettingsSaveController {
  #inFlight = false;

  async run(save: () => Promise<void>, rollback: () => void): Promise<SettingsSaveResult> {
    if (this.#inFlight) {
      rollback();
      return 'busy';
    }

    this.#inFlight = true;
    try {
      await save();
      return 'saved';
    } catch {
      rollback();
      return 'failed';
    } finally {
      this.#inFlight = false;
    }
  }
}
