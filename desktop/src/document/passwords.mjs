// Encrypted-document passwords stay in memory only while the file tab is open.
const passwords = new Map();
export const documentPassword = id => passwords.get(id);
export const rememberPassword = (id, password) => { if (id) passwords.set(id, password); };
export const forgetPassword = id => passwords.delete(id);
export const forgetAllPasswords = () => passwords.clear();
