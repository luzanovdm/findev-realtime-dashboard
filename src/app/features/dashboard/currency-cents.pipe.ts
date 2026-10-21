import { Pipe, PipeTransform } from '@angular/core';
import type Decimal from 'decimal.js';
import { formatCurrencyCents } from './market-metric-formatters';

@Pipe({
  name: 'currencyCents',
})
export class CurrencyCentsPipe implements PipeTransform {
  transform(value: Decimal | null): string {
    return formatCurrencyCents(value);
  }
}
