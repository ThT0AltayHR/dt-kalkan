package com.developmentturkey.dtkalkan.engine

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry as JZipEntry
import java.util.zip.ZipOutputStream

/** JVM tests of the Kotlin engine against the same samples the desktop engine was tested with (dist/engine-test.txt). */
class EngineTest {
    companion object {
        lateinit var root: File; lateinit var data: File; lateinit var an: Analyzer
        @BeforeClass @JvmStatic fun setup() {
            root = File(System.getProperty("dt.root") ?: "..").absoluteFile
            data = File(root, "mobile/app/src/main/assets/data")
            val rules = RulePack.load(File(data, "rules.dat").readBytes(), File(data, "android-rules.dat").readBytes())
            an = Analyzer(SignatureDb.open(File(data, "sigs.bin")), rules, EngineSettings())
        }
        val EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}\$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!\$H+H*"
    }
    private fun s(name: String) = File(root, "work/samples/$name")
    private fun check(f: File, verdict: String, score: Int, threat: String?) {
        val r = an.scanFile(f)
        println("%-10s %3d  %-40s %s".format(r.verdict, r.score, r.threat ?: "-", f.name))
        r.reasons.forEach { println("        [${it.layer}:${it.weight}] ${it.tr}") }
        assertEquals(f.name, verdict, r.verdict); assertEquals(f.name, score, r.score); assertEquals(f.name, threat, r.threat)
    }

    @Test fun rulePackDecodesSameAsDesktop() {
        assertEquals(42, RulePack.load(File(data, "rules.dat").readBytes()).size)
        assertEquals(50, an.rules!!.size)
        // re-encoding round-trip
        val txt = RulePack.decode(File(data, "rules.dat").readBytes())
        assertEquals(txt, RulePack.decode(RulePack.encode(txt)))
    }

    @Test fun desktopSamplesMatchDesktopVerdicts() {
        check(s("eicar.com"), "malicious", 100, "EICAR-Test-File")
        check(s("eicar_arsiv.zip"), "malicious", 100, "EICAR-Test-File")
        check(s("fatura.pdf.vbs"), "malicious", 87, "Trojan-Dropper.VBS.Agent")
        check(s("fatura_odeme.ps1"), "malicious", 93, "HackTool.PowerShell.AmsiBypass")
        check(s("kurulum_yardimcisi.exe"), "suspicious", 40, "HEUR:Packed.Win32.Generic")
        check(s("oyun_hilesi_injector.exe"), "malicious", 85, "HEUR:Trojan.Win32.Injector.Gen")
        check(s("sistem_guncelle.bat"), "malicious", 82, "Trojan.Win32.CoinMiner.Gen")
        check(s("fotograflar.zip"), "clean", 0, null)
        check(s("notlar.txt"), "clean", 0, null)
        check(s("script_temiz.ps1"), "clean", 0, null)
        check(s("temiz_uygulama.exe"), "clean", 5, null)
    }

    @Test fun eicarInDownloadsFolderAndNestedZip() {
        val dl = File(System.getProperty("java.io.tmpdir"), "dt-test/Download").apply { mkdirs() }
        val e = File(dl, "eicar.txt").apply { writeText(EICAR) }
        val inner = File(dl, "inner.zip"); ZipOutputStream(inner.outputStream()).use { it.putNextEntry(JZipEntry("x/eicar.com")); it.write(EICAR.toByteArray()); it.closeEntry() }
        val outer = File(dl, "outer.zip"); ZipOutputStream(outer.outputStream()).use { it.putNextEntry(JZipEntry("inner.zip")); it.write(inner.readBytes()); it.closeEntry() }
        val clean = File(dl, "alisveris-listesi.txt").apply { writeText("süt\nekmek\nyumurta\n") }
        check(e, "malicious", 100, "EICAR-Test-File")
        check(outer, "malicious", 100, "EICAR-Test-File")
        check(clean, "clean", 0, null)
    }

    @Test fun androidLayerFlagsSyntheticBankerAndPassesCleanApp() {
        val dir = File(root, "mobile/tools/testapk/out")
        val t = an.scanFile(File(dir, "dt-test-threat.apk"))
        println("threat apk: ${t.verdict} ${t.score} ${t.threat}"); t.reasons.forEach { println("   ${it.layer}:${it.code}:${it.weight} ${it.tr}") }
        assertEquals("malicious", t.verdict); assertEquals("Trojan-Banker.AndroidOS.Generic", t.threat)
        assertTrue(t.apk!!.permissions.contains("android.permission.READ_SMS")); assertTrue(!t.apk!!.hasLauncher)
        val c = an.scanFile(File(dir, "dt-test-clean.apk"))
        println("clean apk: ${c.verdict} ${c.score}"); assertEquals("clean", c.verdict)
        // installed-app context: system flag lowers weights, trusted installer adds nothing
        val live = an.scanFile(File(dir, "dt-test-clean.apk"), InstalledFacts("com.dttest.notes", installer = "com.android.vending"))
        assertEquals("clean", live.verdict)
    }

    @Test fun signatureDbRebuildIsByteIdentical() {
        val src = File(data, "sigs.bin"); val db = SignatureDb.open(src)
        val out = File(System.getProperty("java.io.tmpdir"), "dt-sigs-rebuilt.bin")
        SignatureDb.build(out, db, LongList(), emptyList(), (db.created / 1000))
        val a = src.readBytes(); val b = out.readBytes()
        assertEquals(a.size, b.size); assertArrayEquals(a, b)
        // adding a hash makes it findable
        val l = LongList(); l.addMd5Hex("0123456789abcdef0123456789abcdef")
        SignatureDb.build(out, db, l, listOf("ab".repeat(32)))
        val n = SignatureDb.open(out)
        assertTrue(n.hasMd5("0123456789abcdef0123456789abcdef")); assertTrue(n.hasSha256("ab".repeat(32)))
        assertEquals(db.total + 2, n.total)
    }
}
