import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Completed orders | VSual demo' };

export default function OrdersPage() {
  return (
    <main data-vsual-orders lang="en-US" tabIndex={-1}>
      <p className="eyebrow">VSual · Synthetic demo data</p>
      <h1>Completed orders</h1>
      <p>
        This controlled dashboard contains fictional order counts. Open the
        VSual extension to compare two months and inspect the values behind its
        answer.
      </p>
      <dl className="orders-context">
        <div>
          <dt>Region</dt>
          <dd data-orders-region>South</dd>
        </div>
        <div>
          <dt>Year</dt>
          <dd data-orders-year>2026</dd>
        </div>
        <div>
          <dt>Metric</dt>
          <dd data-orders-metric>Completed orders</dd>
        </div>
        <div>
          <dt>Unit</dt>
          <dd data-orders-unit>orders</dd>
        </div>
      </dl>
      <div
        className="table-scroll"
        role="region"
        aria-label="Completed orders table"
        tabIndex={0}
      >
        <table data-orders-table lang="en-US">
          <caption>Monthly completed orders — South, 2026</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Completed orders</th>
            </tr>
          </thead>
          <tbody>
            <tr data-row-id="2026-07">
              <th scope="row">
                <time dateTime="2026-07">July 2026</time>
              </th>
              <td data-column="completed">1,200</td>
            </tr>
            <tr data-row-id="2026-08">
              <th scope="row">
                <time dateTime="2026-08">August 2026</time>
              </th>
              <td data-column="completed">900</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Counts are whole completed orders, not currency. Both available monthly
        rows are shown.
      </p>
      <section aria-labelledby="try-heading">
        <h2 id="try-heading">Try the companion</h2>
        <p>“Compare completed orders in the South for August and July.”</p>
        <p lang="vi">
          “So sánh số đơn hoàn thành ở miền Nam tháng 8 với tháng 7 năm 2026.”
        </p>
        <p>
          VSual reads this table only after you allow page processing and ask a
          question or choose to inspect the source table. It does not change
          this page.
        </p>
        <a href="/voice">Voice setup and sign-in instructions</a>
      </section>
      <a href="/">Back to VSual setup</a>
    </main>
  );
}
