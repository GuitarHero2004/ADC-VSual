import type { Metadata } from 'next';
import OrdersDemo from './orders-demo';

export const metadata: Metadata = { title: 'Completed orders | VSual demo' };

export default function OrdersPage() {
  return <OrdersDemo />;
}
