import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';

const v1 = {
  version: 1,
  trips: [
    {
      id: 't1',
      createdAt: '2026-10-09T10:00:00.000Z',
      updatedAt: '2026-10-09T10:00:00.000Z',
      input: { nationality: 'IND', destination: 'GBR', purpose: 'tourism', passportType: 'national', departDate: '2026-12-01', returnDate: '2026-12-15' },
      checklistDone: { passport: true, funds: false },
      answers: { email: 'anna@example.com', surname: 'ERIKSSON' },
      passport: {
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        documentNumber: 'L898902C3',
        nationality: 'UTO',
        issuingState: 'UTO',
        birthDate: '1974-08-12',
        sex: 'F',
        expiryDate: '2030-04-15',
        mrzValid: true,
        imageDataUrl: 'data:image/jpeg;base64,AAAA',
        confirmedAt: '2026-10-09T10:05:00.000Z',
      },
      stops: [],
      flights: [],
      itineraryText: 'Itinerary',
      coverLetter: 'Letter',
      reviewDone: { names: true },
      tracker: { status: 'submitted', reference: 'GWF1' },
    },
  ],
};

describe('vault migration', () => {
  it('moves v1 passport and answers into the first traveller', () => {
    const v2 = migrate(structuredClone(v1));
    expect(v2.version).toBe(2);
    const trip = v2.trips[0];
    expect(trip.travellers).toHaveLength(1);
    const t = trip.travellers[0];
    expect(t.label).toBe('Anna Maria Eriksson');
    expect(t.passport?.documentNumber).toBe('L898902C3');
    expect(t.answers.email).toBe('anna@example.com');
    expect(trip.itineraryText).toBe('Itinerary');
    expect(trip.tracker.reference).toBe('GWF1');
    expect(trip.sharedDocuments).toEqual({});
  });

  it('keeps ticked checklist items ticked for the migrated traveller and the shared list', () => {
    const trip = migrate(structuredClone(v1)).trips[0];
    const tid = trip.travellers[0].id;
    expect(trip.checklistDone[`passport:${tid}`]).toBe(true);
    expect(trip.checklistDone.passport).toBe(true);
    expect(trip.checklistDone[`funds:${tid}`]).toBeFalsy();
  });

  it('drops the inline passport image (images now live in the encrypted document store)', () => {
    const trip = migrate(structuredClone(v1)).trips[0];
    expect(trip.travellers[0].passport).not.toHaveProperty('imageDataUrl');
  });

  it('adds default settings', () => {
    const v2 = migrate(structuredClone(v1));
    expect(v2.settings).toEqual({ whatsappNumber: '', notifyWhatsApp: false, notifyDesktop: true });
  });

  it('leaves v2 data untouched', () => {
    const v2 = migrate(structuredClone(v1));
    expect(migrate(structuredClone(v2))).toEqual(v2);
  });

  it('names a traveller without a passport "Traveller 1"', () => {
    const noPassport = structuredClone(v1) as { trips: Array<Record<string, unknown>> };
    delete noPassport.trips[0].passport;
    expect(migrate(noPassport).trips[0].travellers[0].label).toBe('Traveller 1');
  });

  it('rejects unknown versions instead of guessing', () => {
    expect(() => migrate({ version: 9, trips: [] })).toThrow(/version/);
  });
});
