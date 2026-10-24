import { defaultSettings, newId, titleCase, type AppData, type PassportRecord, type Trip } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V1Trip = Record<string, any>;

/** Upgrades stored data to the current shape. Unknown versions throw rather than being guessed at. */
export function migrate(raw: any): AppData {
  if (raw?.version === 2) return raw as AppData;
  if (raw?.version !== 1) throw new Error(`Unknown vault version: ${String(raw?.version)}`);

  const trips: Trip[] = (raw.trips as V1Trip[]).map((t) => {
    const tid = newId();
    let passport: PassportRecord | undefined;
    if (t.passport) {
      const { imageDataUrl: _dropped, ...rest } = t.passport;
      void _dropped;
      passport = rest as PassportRecord;
    }
    const checklistDone: Record<string, boolean> = {};
    for (const [itemId, done] of Object.entries((t.checklistDone ?? {}) as Record<string, boolean>)) {
      if (!done) continue;
      checklistDone[itemId] = true;
      checklistDone[`${itemId}:${tid}`] = true;
    }
    return {
      id: t.id,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      input: t.input,
      travellers: [
        {
          id: tid,
          label: passport ? titleCase(`${passport.givenNames} ${passport.surname}`) : 'Traveller 1',
          passport,
          answers: t.answers ?? {},
          documents: {},
        },
      ],
      sharedDocuments: {},
      checklistDone,
      stops: t.stops ?? [],
      flights: t.flights ?? [],
      itineraryText: t.itineraryText ?? '',
      coverLetter: t.coverLetter ?? '',
      reviewDone: t.reviewDone ?? {},
      tracker: t.tracker ?? { status: 'preparing' },
    };
  });

  return { version: 2, trips, settings: defaultSettings() };
}
