import { BadRequestException, Injectable } from '@nestjs/common';
import { BankFeedAdapter, BankFeedLine } from './adapters.interface';

/**
 * A genuinely functional adapter — no external network access needed,
 * since most banks let a user export a plain CSV statement. Expected
 * columns (header row required): date,description,amount. `amount` is
 * signed: positive for money in, negative for money out, matching
 * BankStatementLine's convention.
 */
@Injectable()
export class CsvBankFeedAdapter implements BankFeedAdapter {
  parse(raw: string): BankFeedLine[] {
    const rows = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (rows.length === 0) throw new BadRequestException('Empty CSV');

    const header = rows[0].toLowerCase().split(',').map((c) => c.trim());
    const dateIdx = header.indexOf('date');
    const descriptionIdx = header.indexOf('description');
    const amountIdx = header.indexOf('amount');
    if (dateIdx === -1 || descriptionIdx === -1 || amountIdx === -1) {
      throw new BadRequestException(
        'CSV must have a header row with columns: date,description,amount',
      );
    }

    return rows.slice(1).map((row, idx) => {
      const cols = splitCsvLine(row);
      const amount = Number(cols[amountIdx]);
      if (Number.isNaN(amount)) {
        throw new BadRequestException(`Row ${idx + 2}: amount "${cols[amountIdx]}" is not a number`);
      }
      return {
        transactionDate: cols[dateIdx],
        description: cols[descriptionIdx],
        amount,
      };
    });
  }
}

/** Splits one CSV row, honoring double-quoted fields that may contain commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}
