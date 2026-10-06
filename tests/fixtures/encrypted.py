"""Optional encrypted synthetic fixture; no extra extension dependency."""
import sys
from pypdf import PdfWriter

writer = PdfWriter()
writer.add_blank_page(width=500, height=650)
writer.encrypt("pdf-copilot-test", algorithm="AES-128")
writer.write(sys.argv[1])
