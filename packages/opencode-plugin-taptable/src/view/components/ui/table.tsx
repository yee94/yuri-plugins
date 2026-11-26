import type { JSX } from '@solidjs/web';
import { omit } from 'solid-js';
import { cn } from '../../lib/utils';

export function Table(props: JSX.HTMLAttributes<HTMLTableElement> & { class?: string }) {
  const rest = omit(props, 'class');
  return (
    <div data-slot="table-container" class="relative w-full overflow-x-auto">
      <table data-slot="table" {...rest} class={cn('w-full caption-bottom text-sm', props.class)} />
    </div>
  );
}

export function TableHeader(
  props: JSX.HTMLAttributes<HTMLTableSectionElement> & { class?: string },
) {
  const rest = omit(props, 'class');
  return <thead data-slot="table-header" {...rest} class={cn('[&_tr]:border-b', props.class)} />;
}

export function TableBody(props: JSX.HTMLAttributes<HTMLTableSectionElement> & { class?: string }) {
  const rest = omit(props, 'class');
  return (
    <tbody data-slot="table-body" {...rest} class={cn('[&_tr:last-child]:border-0', props.class)} />
  );
}

export function TableRow(props: JSX.HTMLAttributes<HTMLTableRowElement> & { class?: string }) {
  const rest = omit(props, 'class');
  return (
    <tr
      data-slot="table-row"
      {...rest}
      class={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        props.class,
      )}
    />
  );
}

export function TableHead(props: JSX.ThHTMLAttributes<HTMLTableCellElement> & { class?: string }) {
  const rest = omit(props, 'class');
  return (
    <th
      data-slot="table-head"
      {...rest}
      class={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground',
        props.class,
      )}
    />
  );
}

export function TableCell(props: JSX.TdHTMLAttributes<HTMLTableCellElement> & { class?: string }) {
  const rest = omit(props, 'class');
  return (
    <td
      data-slot="table-cell"
      {...rest}
      class={cn('p-2 align-middle whitespace-nowrap', props.class)}
    />
  );
}
