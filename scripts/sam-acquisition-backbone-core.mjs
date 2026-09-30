import { createHash } from "node:crypto";

const text = (value, limit = 500) => String(value || "").trim().replace(/\s+/g, " ").slice(0, limit);
const date = (value) => text(value, 80).slice(0, 10) || null;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value ?? null;
export const contentHash = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export function normalizeOpportunity(row, observedAt) {
  const noticeId = text(row.noticeId || row.notice_id || row.id, 240);
  if (!noticeId) return null;
  const notice = {
    id: `opportunity-notice:${noticeId}`,
    noticeId,
    solicitationNumber: text(row.solicitationNumber || row.solicitation_number, 240) || null,
    title: text(row.title, 500) || "Untitled opportunity",
    noticeType: text(row.type || row.baseType, 80) || null,
    postedDate: date(row.postedDate),
    responseDeadline: date(row.responseDeadLine || row.responseDeadline || row.archiveDate),
    archiveDate: date(row.archiveDate),
    naicsCode: text(row.naicsCode, 20) || null,
    pscCode: text(row.classificationCode || row.pscCode, 20) || null,
    setAside: text(row.typeOfSetAsideDescription || row.typeOfSetAside, 240) || null,
    organizationPath: text(row.fullParentPathName || row.organizationPath, 800) || null,
    organizationPathCode: text(row.fullParentPathCode, 800) || null,
    department: text(row.department, 240) || null,
    subTier: text(row.subTier, 240) || null,
    office: text(row.office, 240) || null,
    active: row.active === true || String(row.active).toLowerCase() === "yes",
    sourceUpdatedAt: text(row.modifiedDate || row.lastModifiedDate || row.updatedDate, 80) || null,
    sourceUrl: text(row.uiLink, 1000) || `https://sam.gov/opp/${encodeURIComponent(noticeId)}/view`,
  };
  const versionHash = contentHash(notice);
  const version = {
    id: `notice-version:${noticeId}:${versionHash.slice(0, 20)}`,
    noticeId,
    versionHash,
    observedAt,
    sourceUpdatedAt: notice.sourceUpdatedAt,
    sourceUrl: notice.sourceUrl,
  };
  const award = row.award || {};
  const awardAction = award.number ? normalizeContractAward({
    piid: award.number,
    modificationNumber: "AWARD_NOTICE",
    actionDate: award.date,
    actionObligation: award.amount,
    recipientName: award.awardee?.name || award.awardeeName,
    recipientUei: award.awardee?.ueiSAM || award.awardee?.uei || award.awardeeUei,
    solicitationNumber: notice.solicitationNumber,
    noticeId,
    sourceUrl: notice.sourceUrl,
  }, observedAt) : null;
  return { notice, version, awardAction };
}

export function normalizeContractAward(row, observedAt) {
  const piid = text(row.piid || row.awardId || row.award_id, 240);
  if (!piid) return null;
  const modificationNumber = text(row.modificationNumber || row.modification_number || row.modNumber || "0", 80) || "0";
  const actionDate = date(row.actionDate || row.action_date || row.dateSigned || row.date_signed);
  const referencedIdvPiid = text(row.referencedIdvPiid || row.referenced_idv_piid || row.parentAwardId, 240) || null;
  const sourceKey = text(row.contractTransactionUniqueKey || row.contract_transaction_unique_key, 300)
    || `${piid}:${modificationNumber}:${actionDate || "undated"}`;
  return {
    id: `award-action:${contentHash(sourceKey).slice(0, 20)}`,
    sourceKey,
    piid,
    modificationNumber,
    actionDate,
    actionType: text(row.actionType || row.action_type, 120) || null,
    actionObligation: number(row.actionObligation ?? row.action_obligation ?? row.federalActionObligation),
    currentValue: number(row.currentValue ?? row.current_total_value_of_award),
    potentialValue: number(row.potentialValue ?? row.potential_total_value_of_award),
    referencedIdvPiid,
    solicitationNumber: text(row.solicitationNumber || row.solicitation_number, 240) || null,
    noticeId: text(row.noticeId, 240) || null,
    recipientName: text(row.recipientName || row.legalBusinessName, 500) || null,
    recipientUei: text(row.recipientUei || row.recipientUEI || row.ueiSAM, 20).toUpperCase() || null,
    recipientCage: text(row.recipientCage || row.cageCode, 20).toUpperCase() || null,
    contractingOfficeCode: text(row.contractingOfficeCode || row.contracting_office_code, 40) || null,
    fundingOfficeCode: text(row.fundingOfficeCode || row.funding_office_code, 40) || null,
    observedAt,
    sourceUrl: text(row.sourceUrl, 1000) || "https://sam.gov/content/contract-data",
  };
}

export function normalizeEntityRegistration(row, observedAt) {
  const registration = row.entityRegistration || row.entity_registration || row;
  const core = row.coreData || row.core_data || {};
  const uei = text(registration.ueiSAM || registration.ueiSam || registration.uei || row.ueiSAM, 20).toUpperCase();
  if (!uei) return null;
  const businessTypes = list(core.businessTypes?.businessTypeList || core.businessTypes || row.businessTypes)
    .map((item) => ({ code: text(item.businessTypeCode || item.code, 40), label: text(item.businessTypeDesc || item.description || item.label, 240) }))
    .filter((item) => item.code || item.label);
  return {
    registration: {
      id: `vendor-registration:${uei}`,
      uei,
      cageCode: text(registration.cageCode || core.cageCode || row.cageCode, 20).toUpperCase() || null,
      legalBusinessName: text(registration.legalBusinessName || row.legalBusinessName, 500) || "Unlabeled registered entity",
      registrationStatus: text(registration.registrationStatus || row.registrationStatus, 80) || null,
      registrationDate: date(registration.registrationDate || row.registrationDate),
      expirationDate: date(registration.registrationExpirationDate || registration.expirationDate || row.expirationDate),
      ultimateParentUei: text(core.entityInformation?.ultimateParentUEISAM || core.ultimateParentUEISAM || row.ultimateParentUEISAM, 20).toUpperCase() || null,
      naicsCodes: list(core.naicsCodes || row.naicsCodes).map((item) => text(item.naicsCode || item, 20)).filter(Boolean),
      pscCodes: list(core.pscCodes || row.pscCodes).map((item) => text(item.pscCode || item, 20)).filter(Boolean),
      observedAt,
      sourceUrl: `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData`,
    },
    certifications: businessTypes.map((item, index) => ({
      id: `business-certification:${uei}:${contentHash(`${item.code}|${item.label}|${index}`).slice(0, 16)}`,
      uei,
      code: item.code || null,
      label: item.label || item.code,
      observedAt,
      sourceUrl: `https://sam.gov/entity/${encodeURIComponent(uei)}/coreData`,
    })),
  };
}

export function normalizeSubaward(row, observedAt) {
  const primeContractKey = text(row.primeContractKey || row.prime_contract_key, 300);
  const reportId = text(row.subawardReportId || row.subaward_report_id || row.subAwardNumber || row.subawardNumber, 240);
  if (!primeContractKey || !reportId) return null;
  return {
    id: `subaward:${contentHash(`${primeContractKey}|${reportId}`).slice(0, 20)}`,
    primeContractKey,
    piid: text(row.piid, 240) || null,
    referencedIdvPiid: text(row.referencedIDVPIID || row.referencedIdvPiid, 240) || null,
    reportId,
    subawardNumber: text(row.subAwardNumber || row.subawardNumber, 240) || null,
    amount: number(row.subAwardAmount ?? row.subawardAmount),
    actionDate: date(row.subAwardDate || row.subawardDate),
    primeUei: text(row.primeAwardeeUEI || row.primeUei, 20).toUpperCase() || null,
    primeName: text(row.primeAwardeeName || row.primeName, 500) || null,
    recipientUei: text(row.subAwardeeUEI || row.subawardeeUei, 20).toUpperCase() || null,
    recipientName: text(row.subAwardeeName || row.subawardeeName, 500) || null,
    recipientCage: text(row.subAwardeeCageCode || row.subawardeeCage, 20).toUpperCase() || null,
    status: text(row.status, 80) || "Published",
    observedAt,
    sourceUrl: "https://sam.gov/content/subaward-reporting",
  };
}

export function hierarchyObservations(notices, observedAt) {
  const observations = new Map();
  for (const notice of notices) {
    const names = String(notice.organizationPath || "").split(/[.>/|]+/).map((value) => text(value, 240)).filter(Boolean);
    const codes = String(notice.organizationPathCode || "").split(/[.>/|]+/).map((value) => text(value, 80)).filter(Boolean);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const parentName = names[index - 1] || null;
      const code = codes[index] || null;
      const key = `${code || name}|${parentName || "root"}`;
      if (!observations.has(key)) observations.set(key, {
        id: `organization-hierarchy-observation:${contentHash(key).slice(0, 20)}`,
        name,
        code,
        parentName,
        parentCode: codes[index - 1] || null,
        observedAt,
        basis: "SAM.gov notice fullParentPathName/fullParentPathCode",
        sourceUrl: notice.sourceUrl,
      });
    }
  }
  return [...observations.values()];
}
