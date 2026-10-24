// What the customer agrees to before the operator files for them. The Schengen text is the declaration
// printed on the harmonised application form (Regulation (EU) 2019/1155, Annex I; saved in
// docs/sources/schengen-form.txt and checked against it in a test). gov.uk shows its declaration only
// inside the online application, so the UK text is our authorisation, labelled as such.

import type { FormId } from '../rules/types';

export interface Declaration {
  /** Shown above the text. */
  title: string;
  /** Where the text comes from. */
  origin: string;
  /** Our authorisation for the operator to act on the customer's behalf. */
  authorisation: string;
  /** The official declaration, when it is published. */
  official?: string;
}

export const SCHENGEN_DECLARATION =
  'I am aware that the visa fee is not refunded if the visa is refused. Applicable in case a multiple-entry visa is applied for: I am aware of the need to have an adequate travel medical insurance for my first stay and any subsequent visits to the territory of Member States. I am aware of and consent to the following: the collection of the data required by this application form and the taking of my photograph and, if applicable, the taking of fingerprints, are mandatory for the examination of the application; and any personal data concerning me which appear on the application form, as well as my fingerprints and my photograph will be supplied to the relevant authorities of the Member States and processed by those authorities, for the purposes of a decision on my application. Such data as well as data concerning the decision taken on my application or a decision whether to annul, revoke or extend a visa issued will be entered into, and stored in the Visa Information System (VIS) for a maximum period of five years, during which it will be accessible to the visa authorities and the authorities competent for carrying out checks on visas at external borders and within the Member States, immigration and asylum authorities in the Member States for the purposes of verifying whether the conditions for the legal entry into, stay and residence on the territory of the Member States are fulfilled, of identifying persons who do not or who no longer fulfil these conditions, of examining an asylum application and of determining responsibility for such examination. Under certain conditions the data will be also available to designated authorities of the Member States and to Europol for the purpose of the prevention, detection and investigation of terrorist offences and of other serious criminal offences. I declare that to the best of my knowledge all particulars supplied by me are correct and complete. I am aware that any false statements will lead to my application being rejected or to the annulment of a visa already granted and may also render me liable to prosecution under the law of the Member State which deals with the application. I undertake to leave the territory of the Member States before the expiry of the visa, if granted. I have been informed that possession of a visa is only one of the prerequisites for entry into the European territory of the Member States. The mere fact that a visa has been granted to me does not mean that I will be entitled to compensation if I fail to comply with the relevant provisions of Article 6(1) of Regulation (EU) No 2016/399 (Schengen Borders Code) and I am therefore refused entry. The prerequisites for entry will be checked again on entry into the European territory of the Member States.';

const AUTHORISE =
  'I confirm that the answers and documents I have given are true, complete and my own. I authorise Visa Navigator to enter them on the official online application on my behalf, exactly as given, and to confirm the declaration below for me. I understand that Visa Navigator does not give legal advice and cannot promise a decision.';

const SCHENGEN: Declaration = {
  title: 'Declaration on the Schengen visa application',
  origin: 'Harmonised application form, Regulation (EU) 2019/1155, Annex I',
  authorisation: AUTHORISE,
  official: SCHENGEN_DECLARATION,
};

const UK: Declaration = {
  title: 'Authorisation for your gov.uk application',
  origin: 'Visa Navigator wording. gov.uk shows its own declaration inside the online application; it says your answers must be true and complete.',
  authorisation:
    'I confirm that the answers and documents I have given are true, complete and my own. I authorise Visa Navigator to enter them on my gov.uk application on my behalf, exactly as given, and to confirm the gov.uk declaration that my answers are true and complete. I understand that giving false information can lead to refusal and a ban from the UK, that Visa Navigator does not give legal advice, and that it cannot promise a decision.',
};

// The DS-160 is signed electronically by the applicant on ceac.state.gov, so this is only an authorisation to prepare it.
const US: Declaration = {
  title: 'Authorisation to prepare your DS-160 answers',
  origin: 'Visa Navigator wording. The DS-160 shows its own certification, which you sign yourself on ceac.state.gov.',
  authorisation:
    'I confirm that the answers and documents I have given are true, complete and my own. I authorise Visa Navigator to prepare my DS-160 answers exactly as given. I will read and sign the DS-160 myself. I understand that Visa Navigator does not give legal advice and cannot promise a decision.',
};

export const DECLARATIONS: Record<FormId, Declaration> = {
  schengen_c: SCHENGEN,
  uk_visitor: UK,
  uk_eta: UK,
  uk_youth_mobility: UK,
  uk_skilled_worker: UK,
  us_b: US,
};

/** The exact text the customer agrees to, stored with their consent. */
export function consentText(formId: FormId): string {
  const d = DECLARATIONS[formId];
  return d.official ? `${d.authorisation}\n\n${d.official}` : d.authorisation;
}
