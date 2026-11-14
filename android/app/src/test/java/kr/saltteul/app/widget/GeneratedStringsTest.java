package kr.saltteul.app.widget;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.IllegalFormatException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

/**
 * Guards res/values/saltteul_strings.xml (generated from copy/ko.json): every string that takes arguments must
 * survive String.format, as getString(id, args) does on the phone (a bare "%" would throw there).
 */
public class GeneratedStringsTest {

    private static final Pattern STRING = Pattern.compile("<string name=\"([^\"]+)\"( formatted=\"false\")?>(.*)</string>");

    @Test
    public void formattedStringsFormat() throws Exception {
        // Unit tests run with the module directory (android/app) as the working directory.
        File xml = new File("src/main/res/values/saltteul_strings.xml");
        assertTrue(xml.getAbsolutePath(), xml.isFile());
        int checked = 0;
        for (String line : Files.readAllLines(xml.toPath(), StandardCharsets.UTF_8)) {
            Matcher m = STRING.matcher(line.trim());
            if (!m.matches() || m.group(2) != null) continue;
            try {
                String.format(m.group(3), "a", "b", "c", "d", "e");
            } catch (IllegalFormatException e) {
                fail(m.group(1) + ": " + e);
            }
            checked++;
        }
        assertTrue(checked > 10);
    }
}
