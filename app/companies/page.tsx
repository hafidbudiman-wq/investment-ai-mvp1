import { companies } from "@/lib/mock-data";

export default function CompaniesPage(){return <><div className="header"><div><h1>Companies</h1><p>Daftar emiten yang dipantau di financial database.</p></div><button className="btn">+ Add company</button></div><div className="card"><table className="table"><thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Data status</th></tr></thead><tbody>{companies.map(c=><tr key={c.ticker}><td className="ticker">{c.ticker}</td><td>{c.name}</td><td>{c.sector}</td><td>{c.status}</td></tr>)}</tbody></table></div></>}
