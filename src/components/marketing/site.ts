// Details only the owner can give, in one place. An empty value means "not added yet": the page that needs it shows a marked gap
// instead of an invented value, and the legal pages say they are being completed. Fill these in and the gaps disappear.
export const SITE = {
  /** The public source repository (it is public, so the site may link to it). */
  github: "https://github.com/davudv84/tend-beta",
  /** The public contact address, shown on Contact, in the footer, the imprint and the privacy notice. */
  contactEmail: "",
  /** The provider named in the imprint, privacy notice and terms (a person's full name, or a company with its legal form). */
  provider: "",
  /** Postal address for service, as one or more lines. */
  address: [] as string[],
  /** A second fast way to reach the provider, as the imprint requires (usually a phone number). */
  phone: "",
  /** The person responsible for the content (§ 18 Abs. 2 MStV); usually the provider. */
  responsible: "",
  /** VAT ID, if there is one. Left empty, the imprint leaves the line out. */
  vatId: "",
  /** Where TEND's database is hosted (named in the privacy notice as a processor). */
  databaseHost: "",
};

/** Whether a legal page still has gaps, so it can say so at the top. */
export const legalGaps = () => !SITE.provider || SITE.address.length === 0 || !SITE.contactEmail || !SITE.phone;
