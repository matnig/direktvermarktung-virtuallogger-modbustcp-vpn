// Validierung für Einspeisemanagement-Config-Updates (PUT).
// Es wird nur validiert, was im Payload vorkommt (Partial-Update).

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateEinspeisemanagement(payload = {}) {
  const errors = [];
  const p = payload;

  const numRange = (key, min, max) => {
    if (p[key] === undefined) return;
    if (!isNum(p[key]) || p[key] < min || p[key] > max) {
      errors.push(`${key} must be a number between ${min} and ${max}`);
    }
  };

  numRange('pRef100Kw', 0.1, 10000);
  numRange('aqSkalaMaxKw', 0.1, 10000);
  numRange('akkuMaxLadeleistungKw', 0, 10000);
  numRange('pInstalliertKw', 0, 100000);
  numRange('strahlungReferenzWm2', 1, 5000);
  numRange('pDiffusKw', 0, 100000);
  numRange('lernHalbwertszeitTage', 1, 3650);
  numRange('lernMinStrahlungWm2', 0, 2000);
  numRange('lernMinLeistungKw', 0, 10000);
  numRange('lernMinBeobachtungen', 10, 1000000);
  numRange('lernMaxAbweichungProzent', 0, 200);
  numRange('dargebotMaxKw', 0, 100000);
  numRange('pKannFaktor', 0.001, 1000);
  numRange('totbandKw', 0, 1000);
  numRange('reglerAbtastMs', 200, 60000);
  numRange('reglerVerstaerkung', 0, 100);
  numRange('maxSchrittKw', 0.1, 10000);
  numRange('dargebotReserveProzent', 0, 1000);
  numRange('dargebotReserveKw', 0, 10000);
  numRange('wrSollwertMaxKw', 0, 10000);
  numRange('wrSollwertMinKw', 0, 10000);
  numRange('failsafeSollwertKw', 0, 10000);
  numRange('logoTimeoutMs', 500, 600000);
  numRange('akkuFreigabeSocProzent', 0, 100);
  numRange('akkuFreigabeUebergangProzent', 0, 100);
  numRange('akkuReserveFaktor', 0, 1);
  numRange('ueberschussToleranzMs', 0, 60000);
  numRange('akkuRestdauerSchwelleS', 0, 86400);
  numRange('akkuRestdauerUebergangS', 0, 86400);
  numRange('akkuReaktionszeitMs', 0, 600000);
  numRange('akkuMindestLadeleistungKw', 0, 10000);
  numRange('akkuSperreWiederholungMs', 0, 3600000);

  for (const key of ['akkuSystemmodusOk', 'akkuBetriebszustandOk']) {
    if (p[key] === undefined) continue;
    if (!Array.isArray(p[key]) || !p[key].every((v) => isNum(v))) {
      errors.push(`${key} must be an array of numbers`);
    }
  }

  if (p.aktuierungAktiv !== undefined && typeof p.aktuierungAktiv !== 'boolean') {
    errors.push('aktuierungAktiv must be a boolean');
  }
  if (p.lernenAktiv !== undefined && typeof p.lernenAktiv !== 'boolean') {
    errors.push('lernenAktiv must be a boolean');
  }
  if (p.sollwertGrenzeAusDargebot !== undefined && typeof p.sollwertGrenzeAusDargebot !== 'boolean') {
    errors.push('sollwertGrenzeAusDargebot must be a boolean');
  }
  if (p.akkuVorsteuerung !== undefined && typeof p.akkuVorsteuerung !== 'boolean') {
    errors.push('akkuVorsteuerung must be a boolean');
  }

  if (p.wrSollwertMinKw !== undefined && p.wrSollwertMaxKw !== undefined
      && isNum(p.wrSollwertMinKw) && isNum(p.wrSollwertMaxKw)
      && p.wrSollwertMinKw > p.wrSollwertMaxKw) {
    errors.push('wrSollwertMinKw must not exceed wrSollwertMaxKw');
  }

  if (p.stufenProzent !== undefined) {
    if (!Array.isArray(p.stufenProzent) || p.stufenProzent.length === 0
        || !p.stufenProzent.every((s) => isNum(s) && s >= 0 && s <= 100)) {
      errors.push('stufenProzent must be a non-empty array of numbers between 0 and 100');
    }
  }

  if (p.kontaktStufeProzent !== undefined) {
    const k = p.kontaktStufeProzent;
    if (typeof k !== 'object' || k === null || Array.isArray(k)) {
      errors.push('kontaktStufeProzent must be an object like {i1,i2,i3}');
    } else {
      for (const [key, val] of Object.entries(k)) {
        if (!isNum(val) || val < 0 || val > 100) {
          errors.push(`kontaktStufeProzent.${key} must be a number between 0 and 100`);
        }
      }
    }
  }

  if (p.bindings !== undefined) {
    const b = p.bindings;
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      errors.push('bindings must be an object');
    } else {
      const idKeys = [
        'direktvermarkterVariableId', 'kontaktI1RegisterId', 'kontaktI2RegisterId',
        'kontaktI3RegisterId', 'akkuSocRegisterId', 'akkuLadeleistungRegisterId',
        'akkuMaxLadeRegisterId', 'akkuLadbareEnergieRegisterId',
        'akkuSystemmodusRegisterId', 'akkuBetriebszustandRegisterId',
        'logoSourceId', 'aq3TargetRegisterId',
        'pIstSourceRegisterId', 'strahlungOstVariableId', 'strahlungWestVariableId',
        'pKannTargetRegisterId', 'pIstTargetRegisterId',
        'netzbetreiberOutLowRegisterId', 'netzbetreiberOutHighRegisterId',
      ];
      for (const k of idKeys) {
        if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') {
          errors.push(`bindings.${k} must be a string id or null`);
        }
      }
      if (b.napRegisterIds !== undefined
          && (!Array.isArray(b.napRegisterIds) || !b.napRegisterIds.every((x) => typeof x === 'string'))) {
        errors.push('bindings.napRegisterIds must be an array of string ids');
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = { validateEinspeisemanagement };
